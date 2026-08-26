import { createClient } from '@libsql/client';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runAutoMigrations } from '../database/dbMigrate.js';

export async function createTestDatabase() {
  const file = path.join(os.tmpdir(), `nexbucket-${randomUUID()}.db`);
  const db = createClient({ url: `file:${file}` });
  await runAutoMigrations(db);
  return { db, close: () => db.close() };
}
