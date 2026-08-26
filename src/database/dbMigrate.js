import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { database, execute } from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_PATH = path.join(__dirname, 'libsql');

export async function runAutoMigrations(db = database) {
  if (!db) {
    console.log('⚠️ [DB Migration] Skipped: TURSO_DATABASE_URL is missing.');
    return false;
  }

  try {
    await execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`, {}, db);
    const appliedResult = await execute('SELECT version FROM schema_migrations', {}, db);
    const applied = new Set(appliedResult.rows.map(row => String(row.version)));
    const files = (await fs.readdir(MIGRATIONS_PATH))
      .filter(file => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
      .sort();
    const pending = files.filter(file => !applied.has(file.slice(0, -4)));

    for (const file of pending) {
      const version = file.slice(0, -4);
      const sql = await fs.readFile(path.join(MIGRATIONS_PATH, file), 'utf8');
      const tx = await db.transaction('write');
      try {
        await tx.executeMultiple(sql);
        await tx.execute({ sql: 'INSERT INTO schema_migrations (version) VALUES (?)', args: [version] });
        await tx.commit();
      } catch (error) {
        if (!tx.closed) await tx.rollback().catch(() => {});
        throw error;
      } finally {
        tx.close();
      }
      console.log(`  ✅ Applied migration: ${file}`);
    }

    if (!pending.length) console.log('✅ [DB Migration] Schema up-to-date.');
    else console.log(`✅ [DB Migration] Applied ${pending.length} migration(s).`);
    return true;
  } catch (error) {
    console.error('❌ [DB Migration] Failed:', error.message);
    throw error;
  }
}
