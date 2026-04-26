/**
 * Временные анкеты с лендинга (до прохождения бота).
 * ref в VK содержит intentId для склейки профиля.
 */
import { getDb } from './db.js';

export function saveIntent(intent) {
  const db = getDb();
  const now = new Date().toISOString();
  const intentId = String(intent.intentId || '');
  const merged = { ...intent, intentId, savedAt: now };
  db.prepare(
    `INSERT INTO intents (intentId, intentJson, savedAt)
     VALUES (?, ?, ?)
     ON CONFLICT(intentId) DO UPDATE SET intentJson = excluded.intentJson, savedAt = excluded.savedAt`
  ).run(intentId, JSON.stringify(merged), now);
}

export function getIntent(intentId) {
  const db = getDb();
  const row = db.prepare(`SELECT intentJson FROM intents WHERE intentId = ?`).get(String(intentId || ''));
  if (!row) return null;
  try {
    return JSON.parse(row.intentJson);
  } catch {
    return null;
  }
}
