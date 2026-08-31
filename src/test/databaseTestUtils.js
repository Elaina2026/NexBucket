import { SQLiteLocalClient } from '../database/sqliteLocal.js';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { runAutoMigrations } from '../database/dbMigrate.js';

export async function createTestDatabase() {
  const file = path.join(os.tmpdir(), `nexbucket-${randomUUID()}.db`);
  const db = new SQLiteLocalClient(file);
  await runAutoMigrations(db);
  return {
    db,
    close: () => {
      db.close();
      try { fs.unlinkSync(file); } catch {}
    },
  };
}
