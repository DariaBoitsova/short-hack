import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'hrflow.sqlite');

/** @type {import('better-sqlite3').Database} */
let db;

function ensureDb() {
  if (db) return db;

  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vkUserId INTEGER NOT NULL,
      sessionId TEXT NOT NULL,
      recordJson TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(vkUserId, sessionId)
    );

    CREATE TABLE IF NOT EXISTS intents (
      intentId TEXT PRIMARY KEY,
      intentJson TEXT NOT NULL,
      savedAt TEXT NOT NULL
    );
  `);

  return db;
}

export function getDb() {
  return ensureDb();
}

export function getDbPath() {
  ensureDb();
  return dbPath;
}

