/**
 * Временные анкеты с лендинга (до прохождения бота).
 * ref в VK содержит intentId для склейки профиля.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'intents.json');

function readAll() {
  try {
    if (!fs.existsSync(FILE)) return {};
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function saveIntent(intent) {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const all = readAll();
  all[intent.intentId] = { ...intent, savedAt: new Date().toISOString() };
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2), 'utf8');
}

export function getIntent(intentId) {
  return readAll()[intentId] || null;
}
