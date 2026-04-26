/**
 * Простое файловое хранилище кандидатов для демо и связки с админкой.
 * В продакшене замените на БД.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'data', 'candidates.json');

function ensureFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}

/** @returns {Array<object>} */
export function readCandidates() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

/** @param {Array<object>} list */
export function writeCandidates(list) {
  ensureFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), 'utf8');
}

/** Добавить или обновить кандидата по vkUserId + sessionId */
export function upsertCandidate(record) {
  const list = readCandidates();
  const idx = list.findIndex(
    (c) => c.vkUserId === record.vkUserId && c.sessionId === record.sessionId
  );
  if (idx >= 0) list[idx] = { ...list[idx], ...record, updatedAt: new Date().toISOString() };
  else list.push({ ...record, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  writeCandidates(list);
  return list;
}
