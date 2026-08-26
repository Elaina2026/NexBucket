import { createClient } from '@libsql/client';
import pg from 'pg';
import { runAutoMigrations } from '../../src/database/dbMigrate.js';
import {
  canonicalSourceRow,
  canonicalTargetRow,
  createRowHasher,
  quoteIdentifier,
  toTargetValue,
} from './canonical.js';
import {
  SOURCE_INFRASTRUCTURE_TABLES,
  TABLES,
  TARGET_INFRASTRUCTURE_TABLES,
} from './manifest.js';

const { Client: PgClient } = pg;
const DEFAULT_PAGE_SIZE = 250;

export function createSourceClient(connectionString = process.env.SOURCE_DATABASE_URL) {
  if (!connectionString) throw new Error('SOURCE_DATABASE_URL is required');
  return new PgClient({ connectionString });
}

export function createTargetClient({
  url = process.env.TURSO_DATABASE_URL,
  authToken = process.env.TURSO_AUTH_TOKEN,
} = {}) {
  if (!url) throw new Error('TURSO_DATABASE_URL is required');
  return createClient({ url, ...(authToken ? { authToken } : {}), intMode: 'bigint' });
}

function orderSql(definition) {
  return definition.primaryKey.map(column => `${quoteIdentifier(column)} ASC`).join(', ');
}

function tupleAfterSql(definition, values) {
  if (!values) return { sql: '', args: [] };
  if (!Array.isArray(values) || values.length !== definition.primaryKey.length) {
    throw new TypeError(`Invalid cursor for ${definition.name}`);
  }
  const groups = definition.primaryKey.map((column, index) => {
    const equal = definition.primaryKey.slice(0, index)
      .map((previous, previousIndex) => `${quoteIdentifier(previous)} = $${previousIndex + 1}`);
    return `(${[...equal, `${quoteIdentifier(column)} > $${index + 1}`].join(' AND ')})`;
  });
  return { sql: ` WHERE ${groups.join(' OR ')}`, args: values };
}

function cursorFromRow(row, definition) {
  return definition.primaryKey.map(column => row[column]);
}

function sqlPlaceholders(length) {
  return Array.from({ length }, () => '?').join(', ');
}

function upsertStatement(definition, row, targetColumns) {
  const columns = targetColumns.filter(column => Object.hasOwn(row, column));
  const conflictColumns = definition.primaryKey.map(quoteIdentifier).join(', ');
  const updates = columns.filter(column => !definition.primaryKey.includes(column));
  const sql = `INSERT INTO ${quoteIdentifier(definition.name)} (${columns.map(quoteIdentifier).join(', ')})
    VALUES (${sqlPlaceholders(columns.length)})
    ON CONFLICT (${conflictColumns}) ${updates.length
      ? `DO UPDATE SET ${updates.map(column => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`).join(', ')}`
      : 'DO NOTHING'}`;
  return {
    sql,
    args: columns.map(column => toTargetValue(column, row[column], definition)),
  };
}

async function sourceTableNames(source) {
  const result = await source.query(`SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name`);
  return result.rows.map(row => String(row.table_name));
}

async function nonemptyUnknownSourceTables(source, names) {
  const occupied = [];
  for (const name of names) {
    const result = await source.query(`SELECT 1 FROM public.${quoteIdentifier(name)} LIMIT 1`);
    if (result.rows.length) occupied.push(name);
  }
  return occupied;
}

async function targetTableNames(target) {
  const result = await target.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  return result.rows.map(row => String(row.name));
}

export async function inspectSchemas(source, target, { requireEmptyTarget = false } = {}) {
  const sourceNames = await sourceTableNames(source);
  const targetNames = await targetTableNames(target);
  const expected = new Set(TABLES.map(definition => definition.name));
  const unknownSource = sourceNames.filter(name => !expected.has(name) && !SOURCE_INFRASTRUCTURE_TABLES.has(name));
  const nonemptyUnknownSource = await nonemptyUnknownSourceTables(source, unknownSource);
  const missingSource = TABLES.map(definition => definition.name).filter(name => !sourceNames.includes(name));
  const missingTarget = TABLES.map(definition => definition.name).filter(name => !targetNames.includes(name));
  const unknownTarget = targetNames.filter(name => !expected.has(name) && !TARGET_INFRASTRUCTURE_TABLES.has(name));
  if (nonemptyUnknownSource.length || missingSource.length || missingTarget.length || unknownTarget.length) {
    throw new Error([
      nonemptyUnknownSource.length ? `Unknown nonempty source tables: ${nonemptyUnknownSource.join(', ')}` : '',
      missingSource.length ? `Missing source tables: ${missingSource.join(', ')}` : '',
      missingTarget.length ? `Missing target tables: ${missingTarget.join(', ')}` : '',
      unknownTarget.length ? `Unknown target tables: ${unknownTarget.join(', ')}` : '',
    ].filter(Boolean).join('; '));
  }
  if (requireEmptyTarget) {
    const occupied = [];
    for (const definition of TABLES) {
      const result = await target.execute(`SELECT 1 FROM ${quoteIdentifier(definition.name)} LIMIT 1`);
      if (result.rows.length) occupied.push(definition.name);
    }
    if (occupied.length) throw new Error(`Target contains application rows: ${occupied.join(', ')}`);
  }
  return { sourceNames, targetNames };
}

async function sourceColumns(source, definition) {
  const result = await source.query(`SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position`, [definition.name]);
  return result.rows.map(row => String(row.column_name));
}

async function targetColumns(target, definition) {
  const result = await target.execute(`PRAGMA table_info(${quoteIdentifier(definition.name)})`);
  const columns = result.rows.map(row => String(row.name));
  if (!columns.length) throw new Error(`Target table missing: ${definition.name}`);
  for (const key of definition.primaryKey) {
    if (!columns.includes(key)) throw new Error(`Target primary key column missing: ${definition.name}.${key}`);
  }
  return columns;
}

async function matchingColumns(source, target, definition) {
  const [sourceNames, targetNames] = await Promise.all([
    sourceColumns(source, definition),
    targetColumns(target, definition),
  ]);
  const missingTarget = sourceNames.filter(column => !targetNames.includes(column));
  const missingSource = targetNames.filter(column => !sourceNames.includes(column));
  if (missingTarget.length || missingSource.length) {
    throw new Error(`Column mismatch for ${definition.name}: source-only=${missingTarget.join(',') || 'none'}; target-only=${missingSource.join(',') || 'none'}`);
  }
  return targetNames;
}

async function ensureMigrationState(target) {
  await target.execute(`CREATE TABLE IF NOT EXISTS migration_state (
    scope TEXT NOT NULL,
    item TEXT NOT NULL,
    cursor_json TEXT,
    row_count INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (scope, item)
  )`);
}

async function getMigrationState(target, item) {
  const result = await target.execute({
    sql: "SELECT cursor_json, row_count, completed FROM migration_state WHERE scope = 'database' AND item = ?",
    args: [item],
  });
  const row = result.rows[0];
  return row ? {
    cursor: row.cursor_json ? JSON.parse(String(row.cursor_json)) : null,
    rowCount: Number(row.row_count),
    completed: Number(row.completed) === 1,
  } : { cursor: null, rowCount: 0, completed: false };
}

function stateStatement(item, cursor, rowCount, completed) {
  return {
    sql: `INSERT INTO migration_state (scope, item, cursor_json, row_count, completed, updated_at)
      VALUES ('database', ?, ?, ?, ?, ?)
      ON CONFLICT(scope, item) DO UPDATE SET
        cursor_json = excluded.cursor_json,
        row_count = excluded.row_count,
        completed = excluded.completed,
        updated_at = excluded.updated_at`,
    args: [item, cursor ? JSON.stringify(cursor) : null, rowCount, completed ? 1 : 0, new Date().toISOString()],
  };
}

async function readSourcePage(source, definition, cursor, pageSize) {
  const after = tupleAfterSql(definition, cursor);
  return source.query({
    text: `SELECT * FROM public.${quoteIdentifier(definition.name)}${after.sql}
      ORDER BY ${orderSql(definition)} LIMIT $${after.args.length + 1}`,
    values: [...after.args, pageSize],
  });
}

export async function applyDatabaseMigration(source, target, {
  pageSize = DEFAULT_PAGE_SIZE,
  sourceSupabaseUrl = process.env.SOURCE_SUPABASE_URL,
  sourceBucket = process.env.SOURCE_SUPABASE_BUCKET || 'learn-images',
  resume = true,
} = {}) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new RangeError('pageSize must be 1-1000');
  await runAutoMigrations(target);
  await ensureMigrationState(target);
  await inspectSchemas(source, target, { requireEmptyTarget: !resume });
  const report = [];
  for (const definition of TABLES) {
    const columns = await matchingColumns(source, target, definition);
    const state = resume ? await getMigrationState(target, definition.name) : { cursor: null, rowCount: 0, completed: false };
    const existing = await target.execute(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(definition.name)}`);
    const existingCount = Number(existing.rows[0]?.count || 0);
    if (existingCount !== state.rowCount) {
      throw new Error(`Target row count does not match migration state for ${definition.name}: ${existingCount} != ${state.rowCount}`);
    }
    if (state.completed) {
      report.push({ table: definition.name, rows: state.rowCount, resumed: true });
      continue;
    }
    let cursor = state.cursor;
    let rowCount = state.rowCount;
    while (true) {
      const result = await readSourcePage(source, definition, cursor, pageSize);
      if (!result.rows.length) {
        await target.batch([stateStatement(definition.name, cursor, rowCount, true)], 'write');
        break;
      }
      const transformed = result.rows.map(row => canonicalSourceRow(row, definition, {
        sourceSupabaseUrl, sourceBucket,
      }));
      const nextCursor = cursorFromRow(result.rows.at(-1), definition);
      const statements = transformed.map(row => upsertStatement(definition, row, columns));
      statements.push(stateStatement(definition.name, nextCursor, rowCount + result.rows.length, false));
      await target.batch(statements, 'write');
      rowCount += result.rows.length;
      cursor = nextCursor;
    }
    report.push({ table: definition.name, rows: rowCount, resumed: Boolean(state.cursor) });
    console.log(`[Migration] ${definition.name}: ${rowCount} row(s)`);
  }
  await repairSequences(target);
  return report;
}

export async function scanDatabase(source, {
  target = null,
  pageSize = DEFAULT_PAGE_SIZE,
  sourceSupabaseUrl = process.env.SOURCE_SUPABASE_URL,
  sourceBucket = process.env.SOURCE_SUPABASE_BUCKET || 'learn-images',
} = {}) {
  const report = [];
  for (const definition of TABLES) {
    if (target) await matchingColumns(source, target, definition);
    let cursor = null;
    const hasher = createRowHasher();
    while (true) {
      const result = await readSourcePage(source, definition, cursor, pageSize);
      if (!result.rows.length) break;
      for (const row of result.rows) hasher.update(canonicalSourceRow(row, definition, {
        sourceSupabaseUrl, sourceBucket,
      }));
      cursor = cursorFromRow(result.rows.at(-1), definition);
    }
    report.push({ table: definition.name, ...hasher.digest() });
  }
  return report;
}

async function scanTargetTable(target, definition, pageSize) {
  const hasher = createRowHasher();
  let offset = 0;
  while (true) {
    const result = await target.execute({
      sql: `SELECT * FROM ${quoteIdentifier(definition.name)} ORDER BY ${orderSql(definition)} LIMIT ? OFFSET ?`,
      args: [pageSize, offset],
    });
    if (!result.rows.length) break;
    for (const row of result.rows) hasher.update(canonicalTargetRow(row, definition));
    offset += result.rows.length;
  }
  return { table: definition.name, ...hasher.digest() };
}

export async function verifyDatabaseMigration(source, target, {
  pageSize = DEFAULT_PAGE_SIZE,
  sourceSupabaseUrl = process.env.SOURCE_SUPABASE_URL,
  sourceBucket = process.env.SOURCE_SUPABASE_BUCKET || 'learn-images',
} = {}) {
  await inspectSchemas(source, target);
  const sourceManifest = await scanDatabase(source, {
    target, pageSize, sourceSupabaseUrl, sourceBucket,
  });
  const targetManifest = [];
  const mismatches = [];
  for (const definition of TABLES) {
    const targetEntry = await scanTargetTable(target, definition, pageSize);
    targetManifest.push(targetEntry);
    const sourceEntry = sourceManifest.find(entry => entry.table === definition.name);
    if (sourceEntry.count !== targetEntry.count || sourceEntry.sha256 !== targetEntry.sha256) {
      mismatches.push({ table: definition.name, source: sourceEntry, target: targetEntry });
    }
  }
  const integrity = await target.execute('PRAGMA integrity_check');
  const foreignKeys = await target.execute('PRAGMA foreign_key_check');
  const integrityOk = integrity.rows.length === 1 && String(integrity.rows[0].integrity_check) === 'ok';
  if (!integrityOk || foreignKeys.rows.length || mismatches.length) {
    const error = new Error(`Migration verification failed: ${mismatches.length} table mismatch(es), integrity=${integrityOk ? 'ok' : 'failed'}, foreignKeys=${foreignKeys.rows.length}`);
    error.report = { source: sourceManifest, target: targetManifest, mismatches, integrity: integrity.rows, foreignKeys: foreignKeys.rows };
    throw error;
  }
  await verifySequences(target);
  return { source: sourceManifest, target: targetManifest, mismatches: [], integrity: 'ok', foreignKeys: [] };
}

async function integerPrimaryKeyTables(target) {
  const result = [];
  for (const definition of TABLES) {
    if (definition.primaryKey.length !== 1) continue;
    const key = definition.primaryKey[0];
    if (!definition.integers.has(key)) continue;
    const info = await target.execute(`PRAGMA table_info(${quoteIdentifier(definition.name)})`);
    const column = info.rows.find(row => String(row.name) === key);
    if (column && Number(column.pk) === 1) result.push({ definition, key });
  }
  return result;
}

export async function repairSequences(target) {
  for (const { definition, key } of await integerPrimaryKeyTables(target)) {
    const result = await target.execute(`SELECT MAX(${quoteIdentifier(key)}) AS maximum FROM ${quoteIdentifier(definition.name)}`);
    const maximum = result.rows[0]?.maximum;
    if (maximum === null || maximum === undefined) continue;
    const updated = await target.execute({
      sql: 'UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?',
      args: [maximum, definition.name],
    });
    if (!updated.rowsAffected) {
      await target.execute({
        sql: 'INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)',
        args: [definition.name, maximum],
      });
    }
  }
}

export async function verifySequences(target) {
  for (const { definition, key } of await integerPrimaryKeyTables(target)) {
    const [maxResult, sequenceResult] = await Promise.all([
      target.execute(`SELECT MAX(${quoteIdentifier(key)}) AS maximum FROM ${quoteIdentifier(definition.name)}`),
      target.execute({ sql: 'SELECT seq FROM sqlite_sequence WHERE name = ?', args: [definition.name] }),
    ]);
    const maximum = maxResult.rows[0]?.maximum;
    if (maximum === null || maximum === undefined) continue;
    const sequence = sequenceResult.rows[0]?.seq;
    if (sequence === null || sequence === undefined || BigInt(sequence) < BigInt(maximum)) {
      throw new Error(`Invalid sqlite_sequence for ${definition.name}`);
    }
  }
}

export async function dryRunDatabaseMigration(source, target, options = {}) {
  await runAutoMigrations(target);
  await inspectSchemas(source, target, { requireEmptyTarget: options.requireEmptyTarget !== false });
  const sourceManifest = await scanDatabase(source, { ...options, target });
  return { source: sourceManifest, targetReady: true };
}

export async function withDatabaseClients(callback, options = {}) {
  const source = options.source || createSourceClient(options.sourceUrl);
  const target = options.target || createTargetClient({ url: options.targetUrl, authToken: options.targetAuthToken });
  const ownSource = !options.source;
  const ownTarget = !options.target;
  try {
    if (ownSource) await source.connect();
    return await callback(source, target);
  } finally {
    if (ownSource) await source.end().catch(() => {});
    if (ownTarget) target.close();
  }
}
