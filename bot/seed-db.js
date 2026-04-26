/**
 * Seed SQLite demo data (50 candidates).
 * Run: node bot/seed-db.js
 */
import { randomUUID } from 'crypto';
import { getDb } from './db.js';
import { VACANCY_IDS, VACANCIES, getSkillTags, getWeights } from './vacancies.js';

const db = getDb();

function rnd(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[rnd(0, arr.length - 1)];
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function weighted(hard100, soft100, motiv100, vacancyId) {
  const w = getWeights(vacancyId);
  return Math.round(w.hard * hard100 + w.soft * soft100 + w.motiv * motiv100);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function randomIsoWithinDays(daysBack = 30) {
  const now = Date.now();
  const ms = rnd(0, daysBack * 24 * 60 * 60 * 1000);
  return new Date(now - ms).toISOString();
}

const firstNames = [
  'Иван',
  'Мария',
  'Алексей',
  'Екатерина',
  'Дмитрий',
  'Анна',
  'Никита',
  'Ольга',
  'Павел',
  'Софья',
  'Артём',
  'Дарья',
  'Кирилл',
  'Виктория',
  'Максим',
  'Полина',
];
const lastNames = [
  'Иванов',
  'Петров',
  'Сидоров',
  'Смирнов',
  'Кузнецов',
  'Попов',
  'Лебедев',
  'Козлова',
  'Новикова',
  'Морозов',
  'Волков',
  'Соловьёв',
  'Васильев',
  'Зайцев',
  'Павлова',
  'Семёнова',
];
const patronymics = [
  'Иванович',
  'Петрович',
  'Алексеевич',
  'Дмитриевич',
  'Сергеевич',
  'Андреевич',
  'Олегович',
  'Михайлович',
  'Игоревич',
  'Владимирович',
  'Ивановна',
  'Петровна',
  'Алексеевна',
  'Дмитриевна',
  'Сергеевна',
  'Андреевна',
];

function makeFio() {
  const ln = pick(lastNames);
  const fn = pick(firstNames);
  // часть будет 2 слова, часть 3
  const usePatro = Math.random() < 0.7;
  return usePatro ? `${ln} ${fn} ${pick(patronymics)}` : `${ln} ${fn}`;
}

function makePhone() {
  // +7 + 10 digits
  const n1 = rnd(900, 999);
  const n2 = rnd(100, 999);
  const n3 = rnd(10, 99);
  const n4 = rnd(10, 99);
  return `+7${n1}${n2}${pad2(n3)}${pad2(n4)}`;
}

function makeAiVerdict(polite, toxic) {
  if (toxic) return 'Риск конфликтного тона. Нужна ручная проверка.';
  if (!polite) return 'Тон сухой, возможны сложности в коммуникации.';
  return 'Вежливо, структурировано, ориентирован на результат.';
}

function makeSkillFit(vacancyId) {
  // 80% проходят гейт, 20% — нет
  const passed = Math.random() < 0.8;
  const fitScore = passed ? rnd(60, 98) : rnd(10, 55);
  const missing =
    passed
      ? []
      : vacancyId === 'vac_python'
        ? ['Python', 'FastAPI/Flask', 'SQL']
        : vacancyId === 'vac_java'
          ? ['Java', 'Spring', 'SQL']
          : ['Ключевые компетенции роли'];
  return { passed, fitScore, missing, reason: passed ? 'Компетенции подтверждены' : 'Критичные навыки не найдены в тексте' };
}

function makeScores(vacancyId) {
  const hardCorrect = rnd(0, 5);
  const hard100 = Math.round((hardCorrect / 5) * 100);
  const soft10 = rnd(2, 10);
  const soft100 = soft10 * 10;
  let motiv100 = rnd(55, 92);
  if (hardCorrect >= 4) motiv100 = clamp(motiv100 + 8, 0, 100);
  if (soft10 >= 8) motiv100 = clamp(motiv100 + 6, 0, 100);
  return { hardCorrect, hard100, soft10, soft100, motiv100 };
}

function seedCandidates(count = 50) {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO candidates (vkUserId, sessionId, recordJson, createdAt, updatedAt)
     VALUES (@vkUserId, @sessionId, @recordJson, @createdAt, @updatedAt)
     ON CONFLICT(vkUserId, sessionId) DO UPDATE SET
       recordJson = excluded.recordJson,
       updatedAt = excluded.updatedAt`
  );

  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const vacancyId = pick(VACANCY_IDS);
      const v = VACANCIES[vacancyId];
      const vkUserId = rnd(10_000_000, 99_999_999);
      const sessionId = randomUUID();
      const { hardCorrect, hard100, soft10, soft100, motiv100 } = makeScores(vacancyId);
      const fit = makeSkillFit(vacancyId);
      let weightedScore = weighted(hard100, soft100, motiv100, vacancyId);
      if (!fit.passed) weightedScore = Math.min(weightedScore, Math.round(35 + fit.fitScore * 0.15));

      const polite = Math.random() < 0.86;
      const toxic = !polite && Math.random() < 0.35;

      const createdAt = randomIsoWithinDays(45);
      const updatedAt = randomIsoWithinDays(7);

      const record = {
        vkUserId,
        sessionId,
        intentId: null,
        fio: makeFio(),
        phone: makePhone(),
        vacancyId,
        vacancyTitle: v.title,
        category: v.category,
        hardScore: hardCorrect,
        hardPct: hard100,
        softScore: soft100,
        motivationScore: motiv100,
        weightHard: Number(getWeights(vacancyId).hard.toFixed(4)),
        weightSoft: Number(getWeights(vacancyId).soft.toFixed(4)),
        weightMotiv: Number(getWeights(vacancyId).motiv.toFixed(4)),
        weightedScore,
        skillGatePassed: Boolean(fit.passed),
        skillFitScore: fit.fitScore,
        skillFitReason: fit.reason,
        skillFitMissing: fit.missing,
        polite: polite && !toxic,
        toxic,
        aiVerdict: makeAiVerdict(polite, toxic),
        aiScore: soft10,
        tags: getSkillTags(vacancyId),
        createdAt,
        updatedAt,
      };

      stmt.run({
        vkUserId,
        sessionId,
        recordJson: JSON.stringify(record),
        createdAt,
        updatedAt,
      });
    }
  });

  tx();
  return now;
}

const n = Number(process.argv[2] || 50);
seedCandidates(n);
console.log(`Seeded ${n} candidates into SQLite.`);

