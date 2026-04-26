/**
 * SQLite-хранилище кандидатов (для демо и связки с админкой).
 * Таблица: candidates(vkUserId, sessionId) UNIQUE, recordJson.
 */
import { getDb } from './db.js';

/** @returns {Array<object>} */
export function readCandidates() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT recordJson
       FROM candidates
       ORDER BY datetime(updatedAt) DESC, id DESC`
    )
    .all();
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.recordJson);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** Добавить или обновить кандидата по vkUserId + sessionId */
export function upsertCandidate(record) {
  const db = getDb();
  const now = new Date().toISOString();
  const vkUserId = Number(record.vkUserId) || 0;
  const sessionId = String(record.sessionId || '');
  const existing = db
    .prepare(`SELECT recordJson, createdAt FROM candidates WHERE vkUserId = ? AND sessionId = ?`)
    .get(vkUserId, sessionId);

  const createdAt = existing?.createdAt || record.createdAt || now;
  const merged = existing
    ? { ...safeJson(existing.recordJson), ...record, createdAt, updatedAt: now }
    : { ...record, createdAt, updatedAt: now };

  db.prepare(
    `INSERT INTO candidates (vkUserId, sessionId, recordJson, createdAt, updatedAt)
     VALUES (@vkUserId, @sessionId, @recordJson, @createdAt, @updatedAt)
     ON CONFLICT(vkUserId, sessionId) DO UPDATE SET
       recordJson = excluded.recordJson,
       updatedAt = excluded.updatedAt`
  ).run({
    vkUserId,
    sessionId,
    recordJson: JSON.stringify(merged),
    createdAt,
    updatedAt: now,
  });

  return readCandidates();
}

function safeJson(s) {
  try {
    return JSON.parse(String(s || '{}'));
  } catch {
    return {};
  }
}
