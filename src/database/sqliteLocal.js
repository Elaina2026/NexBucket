import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

export class SQLiteLocalClient {
  constructor(filePath = 'data/nexbucket.db') {
    this.filePath = path.resolve(filePath);
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(this.filePath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  formatParams(params = []) {
    if (Array.isArray(params)) return params;
    if (params && typeof params === 'object') return Object.values(params);
    return [];
  }

  async execute(param, maybeArgs = []) {
    let querySql = '';
    let queryArgs = [];

    if (typeof param === 'string') {
      querySql = param;
      queryArgs = this.formatParams(maybeArgs);
    } else if (param && typeof param === 'object') {
      querySql = param.sql || '';
      const rawArgs = param.args !== undefined ? param.args : (param.params !== undefined ? param.params : maybeArgs);
      queryArgs = this.formatParams(rawArgs);
    }

    const trimmed = querySql.trim();
    const isSelect = /^(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(trimmed);
    const hasReturning = /\bRETURNING\b/i.test(trimmed);

    if (isSelect || hasReturning) {
      const stmt = this.db.prepare(querySql);
      const rows = stmt.all(...queryArgs);
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return { rows, columns, rowsAffected: rows.length, changes: rows.length, lastInsertRowid: null };
    }

    const stmt = this.db.prepare(querySql);
    const result = stmt.run(...queryArgs);
    return {
      rows: [],
      columns: [],
      rowsAffected: Number(result.changes || 0),
      changes: Number(result.changes || 0),
      lastInsertRowid: result.lastInsertRowid ?? null,
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
      if (transaction) {
        try { this.db.exec('ROLLBACK;'); } catch {}
      }
      throw err;
    }
  }

  async transaction(mode = 'write') {
    this.db.exec('BEGIN IMMEDIATE;');
    let closed = false;
    const self = this;
    return {
      get closed() { return closed; },
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
          try { self.db.exec('ROLLBACK;'); } catch {}
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
  }
}

