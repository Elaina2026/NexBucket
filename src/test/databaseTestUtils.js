import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { runAutoMigrations } from '../database/dbMigrate.js';

class SQLiteMockClient {
  constructor(filePath) {
    this.filePath = filePath;
    this.db = new DatabaseSync(filePath);
  }

  async execute(param, maybeArgs = []) {
    let querySql = '';
    let queryArgs = [];

    if (typeof param === 'string') {
      querySql = param;
      queryArgs = Array.isArray(maybeArgs) ? maybeArgs : Object.values(maybeArgs || {});
    } else if (param && typeof param === 'object') {
      querySql = param.sql || '';
      const rawArgs = param.args !== undefined ? param.args : (param.params !== undefined ? param.params : maybeArgs);
      queryArgs = Array.isArray(rawArgs) ? rawArgs : Object.values(rawArgs || {});
    }

    const trimmed = querySql.trim();
    const isSelect = /^(SELECT|PRAGMA|WITH)\b/i.test(trimmed);
    const hasReturning = /\bRETURNING\b/i.test(trimmed);

    if (isSelect || hasReturning) {
      const stmt = this.db.prepare(querySql);
      const rows = stmt.all(...queryArgs);
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return { rows, columns, rowsAffected: rows.length, changes: rows.length };
    }

    const stmt = this.db.prepare(querySql);
    const result = stmt.run(...queryArgs);
    return {
      rows: [],
      columns: [],
      rowsAffected: Number(result.changes || 0),
      changes: Number(result.changes || 0),
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  async query(sql, params = []) {
    return this.execute(sql, params);
  }

  async executeMultiple(sql) {
    this.db.exec(sql);
  }

  async batch(statements, transaction = true) {
    if (transaction) this.db.exec('BEGIN TRANSACTION;');
    const results = [];
    try {
      for (let i = 0; i < statements.length; i++) {
        const st = statements[i];
        const sql = typeof st === 'string' ? st : st.sql;
        const args = typeof st === 'string' ? [] : (st.params || st.args || []);
        const res = await this.execute(sql, args);
        results.push({ statementIndex: i, result: res });
      }
      if (transaction) this.db.exec('COMMIT;');
      return { results, totalDurationMs: 1 };
    } catch (err) {
      if (transaction) this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  async transaction(mode = 'write') {
    this.db.exec('BEGIN IMMEDIATE;');
    let closed = false;
    const self = this;
    return {
      closed: false,
      execute: async (param, args) => self.execute(param, args),
      executeMultiple: async (sql) => self.executeMultiple(sql),
      commit: async () => {
        if (!closed) {
          self.db.exec('COMMIT;');
          closed = true;
        }
      },
      rollback: async () => {
        if (!closed) {
          self.db.exec('ROLLBACK;');
          closed = true;
        }
      },
      close: () => {
        if (!closed) {
          try { self.db.exec('ROLLBACK;'); } catch {}
          closed = true;
        }
      },
    };
  }

  close() {
    this.db.close();
    try {
      fs.unlinkSync(this.filePath);
    } catch {}
  }
}

export async function createTestDatabase() {
  const file = path.join(os.tmpdir(), `nexbucket-${randomUUID()}.db`);
  const db = new SQLiteMockClient(file);
  await runAutoMigrations(db);
  return { db, close: () => db.close() };
}
