import pkg from 'pg';
const { Client } = pkg;
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_LOCK_ID = 42;

export async function runAutoMigrations() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString || connectionString.includes('[YOUR-PASSWORD]')) {
    console.log('⚠️ [DB Migration] Skipped: DIRECT_URL/DATABASE_URL is missing or password not configured in .env');
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL is invalid. Percent-encode special password characters, e.g. / as %2F and @ as %40.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
    throw new Error('DATABASE_URL must start with postgres:// or postgresql://');
  }

  let client;
  let locked = false;
  try {
    client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    await client.connect();
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    locked = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = (await fs.readdir(path.join(__dirname, 'migrations')))
      .filter(file => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
      .sort();
    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map(row => row.version));

    const pendingFiles = files.filter(file => !applied.has(file.slice(0, -4)));
    if (pendingFiles.length === 0) {
      console.log('✅ [DB Migration] Schema up-to-date.');
    } else {
      const schemaSql = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
      await client.query(schemaSql);

      let count = 0;
      for (const file of pendingFiles) {
        const version = file.slice(0, -4);
        const sql = await fs.readFile(path.join(__dirname, 'migrations', file), 'utf8');
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
          await client.query('COMMIT');
          count++;
          console.log(`  ✅ Applied migration: ${file}`);
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }

      console.log(`✅ [DB Migration] Applied ${count} migration(s).`);
    }
  } catch (error) {
    console.error('❌ [DB Migration] Failed:', error.message);
    throw error;
  } finally {
    if (locked && client) {
      try { await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]); } catch {}
    }
    if (client) {
      try { await client.end(); } catch {}
    }
  }
}
