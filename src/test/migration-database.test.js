import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDatabaseMigration,
  verifyDatabaseMigration,
} from '../../scripts/migrate/database.js';
import { TABLE_BY_NAME, TABLES } from '../../scripts/migrate/manifest.js';
import { createTestDatabase } from './databaseTestUtils.js';

function compareRows(left, right, definition) {
  for (const key of definition.primaryKey) {
    const order = String(left[key]).localeCompare(String(right[key]), 'en', { numeric: true });
    if (order) return order;
  }
  return 0;
}

function afterCursor(row, cursor, definition) {
  if (!cursor.length) return true;
  for (let index = 0; index < definition.primaryKey.length; index++) {
    const comparison = String(row[definition.primaryKey[index]])
      .localeCompare(String(cursor[index]), 'en', { numeric: true });
    if (comparison > 0) return true;
    if (comparison < 0) return false;
  }
  return false;
}

function sourceDatabase(target, fixtures, { failOnce } = {}) {
  let failed = false;
  return {
    async query(statement, values = []) {
      const text = typeof statement === 'string' ? statement : statement.text;
      const args = typeof statement === 'string' ? values : statement.values;
      if (text.includes('information_schema.tables')) {
        return { rows: TABLES.map(definition => ({ table_name: definition.name })) };
      }
      if (text.includes('information_schema.columns')) {
        const result = await target.execute(`PRAGMA table_info("${String(args[0])}")`);
        return { rows: result.rows.map(row => ({ column_name: String(row.name) })) };
      }
      const match = text.match(/SELECT \* FROM public\."([a-z0-9_]+)"/i);
      if (!match) throw new Error(`Unsupported source query: ${text}`);
      const table = match[1];
      const definition = TABLE_BY_NAME.get(table);
      const pageSize = Number(args.at(-1));
      const cursor = args.slice(0, -1);
      const rows = [...(fixtures[table] || [])]
        .sort((left, right) => compareRows(left, right, definition))
        .filter(row => afterCursor(row, cursor, definition))
        .slice(0, pageSize)
        .map(row => structuredClone(row));
      if (failOnce?.table === table && cursor.length && !failed) {
        failed = true;
        throw new Error('simulated source interruption');
      }
      return { rows };
    },
  };
}

test('database migration resumes after interruption and rejects verification drift', async t => {
  const { db: target, close } = await createTestDatabase();
  t.after(close);
  const fixtures = {
    blacklist: [
      { user_id: '1', reason: 'one', added_at: '2026-01-01T00:00:00.000Z' },
      { user_id: '2', reason: 'two', added_at: '2026-01-02T00:00:00.000Z' },
    ],
  };
  const source = sourceDatabase(target, fixtures, { failOnce: { table: 'blacklist' } });

  await assert.rejects(
    applyDatabaseMigration(source, target, { pageSize: 1, resume: true }),
    /simulated source interruption/,
  );
  assert.equal(Number((await target.execute('SELECT COUNT(*) AS count FROM blacklist')).rows[0].count), 1);

  const resumed = await applyDatabaseMigration(source, target, { pageSize: 1, resume: true });
  assert.equal(resumed.find(entry => entry.table === 'blacklist').rows, 2);
  assert.equal(resumed.find(entry => entry.table === 'blacklist').resumed, true);
  assert.equal((await verifyDatabaseMigration(source, target, { pageSize: 1 })).mismatches.length, 0);

  await target.execute("UPDATE blacklist SET reason = 'tampered' WHERE user_id = '2'");
  await assert.rejects(
    verifyDatabaseMigration(source, target, { pageSize: 1 }),
    error => error.report?.mismatches?.some(entry => entry.table === 'blacklist'),
  );
});
