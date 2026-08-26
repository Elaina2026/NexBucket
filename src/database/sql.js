import {
  all as clientAll,
  batch as clientBatch,
  database,
  execute as clientExecute,
  one as clientOne,
  transaction as clientTransaction,
} from './client.js';

function ensureDatabase(db) {
  if (!db) throw new Error('Database not configured');
  return db;
}

export function execute(db, sql, args = []) {
  return clientExecute(sql, args, ensureDatabase(db));
}

export function all(db, sql, args = []) {
  return clientAll(sql, args, ensureDatabase(db));
}

export function one(db, sql, args = []) {
  return clientOne(sql, args, ensureDatabase(db));
}

export function batch(db, statements, mode = 'write') {
  return clientBatch(statements, mode, ensureDatabase(db));
}

export function transaction(db, callback) {
  return clientTransaction(callback, ensureDatabase(db));
}

export { database };
