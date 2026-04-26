/**
 * Логика диалога VK: выбор направления, Hard-викторина (5 вопросов), Soft-кейс → GigaChat.
 * Состояние хранится в памяти процесса (для продакшена — Redis/БД).
 */
import { randomUUID } from 'crypto';
import {
  getVacancy,
  VACANCY_IDS,
  VACANCIES,
  getWeights,
  getSkillTags,
  getRequiredSkillsDescription,
} from './vacancies.js';
import { analyzeSoftSkillsAnswer, evaluateSkillFit } from './gigachat.js';
import { upsertCandidate } from './storage.js';
import { getIntent } from './intent-storage.js';

/** @type {Map<number, object>} */
const sessions = new Map();

function shuffleOptions(answers) {
  const correctText = answers[0];
  const arr = [...answers];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const correctIndex = arr.findIndex((t) => t === correctText);
  return { labels: arr, correctIndex };
}

function kbInline(rows) {
  return JSON.stringify({
    inline: true,
    buttons: rows.map((row) =>
      row.map((btn) => ({
        action: { type: 'text', label: btn.label.slice(0, 64), payload: btn.payload },
        color: btn.color || 'secondary',
      }))
    ),
  });
}

function listVacanciesText() {
  const lines = VACANCY_IDS.map((id, i) => `${i + 1}. ${VACANCIES[id].title}`);
  return (
    'AI-рекрутинг X5: выберите направление, ответив цифрой 1–' +
    VACANCY_IDS.length +
    ':\n' +
    lines.join('\n')
  );
}

function parseRefFromMessage(message) {
  const ref = message?.ref;
  if (ref && typeof ref === 'string') {
    try {
      const j = JSON.parse(ref);
      return { vacancyId: j.v && VACANCIES[j.v] ? j.v : null, intentId: j.i || null };
    } catch {
      if (VACANCIES[ref]) return { vacancyId: ref, intentId: null };
    }
  }
  return { vacancyId: null, intentId: null };
}

function parsePickNumber(text) {
  const m = String(text || '')
    .trim()
    .match(/^(\d{1,2})$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n >= 1 && n <= VACANCY_IDS.length) return VACANCY_IDS[n - 1];
  return null;
}

function scoreFromHard(correctCount) {
  return Math.round((correctCount / 5) * 100);
}

function motivationScore(session) {
  // Демо-эвристика мотивации по прохождению без «срыва» диалога
  let m = 70;
  if (session.hardCorrect >= 4) m += 15;
  else if (session.hardCorrect >= 3) m += 8;
  if (session.soft?.score >= 8) m += 10;
  return Math.min(100, m);
}

/**
 * @param {import('./vk-api.js').VkApi} vk
 * @param {object} message объект message из Long Poll
 */
export async function handleIncomingMessage(vk, message) {
  const peerId = message.peer_id;
  const fromId = message.from_id;
  const text = message.text || '';
  const { vacancyId: refVacancyId, intentId: refIntentId } = parseRefFromMessage(message);

  let session = sessions.get(fromId);
  if (!session) {
    session = {
      sessionId: randomUUID(),
      userId: fromId,
      peerId,
      stage: 'PICK',
      vacancyId: null,
      intentId: null,
      hardIndex: 0,
      hardCorrect: 0,
      soft: null,
    };
    sessions.set(fromId, session);
  }

  if (refIntentId) session.intentId = refIntentId;

  // Старт: ref с лендинга → сразу направление
  if (session.stage === 'PICK' && refVacancyId && !session.vacancyId) {
    session.vacancyId = refVacancyId;
    session.stage = 'HARD';
    session.hardIndex = 0;
    session.hardCorrect = 0;
    await vk.sendMessage(
      peerId,
      `Привет! Вижу отклик на «${VACANCIES[refVacancyId].title}». Начнём короткую викторину (5 вопросов), затем мини-кейс для ИИ-анализа.`
    );
    await sendHardQuestion(vk, session);
    return;
  }

  if (session.stage === 'PICK') {
    const picked = parsePickNumber(text);
    if (!picked) {
      await vk.sendMessage(peerId, listVacanciesText());
      return;
    }
    session.vacancyId = picked;
    session.stage = 'HARD';
    session.hardIndex = 0;
    session.hardCorrect = 0;
    await vk.sendMessage(peerId, `Отлично: ${VACANCIES[picked].title}. 5 вопросов с вариантами — выберите кнопкой ниже.`);
    await sendHardQuestion(vk, session);
    return;
  }

  if (session.stage === 'HARD') {
    await handleHardAnswer(vk, message, session);
    return;
  }

  if (session.stage === 'SOFT') {
    const answer = text.trim();
    if (answer.length < 5) {
      await vk.sendMessage(peerId, 'Пожалуйста, развёрнутее (хотя бы пара предложений).');
      return;
    }
    await vk.sendMessage(peerId, 'Анализирую ответ в GigaChat и сверяю навыки с вакансией…');
    try {
      const ai = await analyzeSoftSkillsAnswer(answer, VACANCIES[session.vacancyId].title);
      session.soft = { ...ai, userAnswer: answer.slice(0, 2000) };
      session.stage = 'DONE';
      const politeLabel = ai.toxic || !ai.polite ? 'Токсичность/риск' : 'Вежливый тон';
      const saved = await persistSession(session);
      const gateLine = saved.skillGatePassed
        ? `Соответствие навыков (ИИ): ${saved.skillFitScore}/100 — в топе.`
        : `Соответствие навыков (ИИ): ${saved.skillFitScore}/100 — не хватает: ${(saved.skillMissing || []).join('; ') || saved.skillFitReason}. В рейтинге топа не участвуете до доп. проверки HR.`;
      await vk.sendMessage(
        peerId,
        `Спасибо! Итог:\nHard: ${session.hardCorrect}/5 (0–100: ${saved.hard100})\nSoft (ИИ): ${ai.score}/10 (0–100: ${saved.soft100})\nМотивация: ${saved.motiv100}\nИтог взвешенный: ${saved.weightedScore}/100\n${gateLine}\n${politeLabel}\nРезюме ИИ: ${ai.summary}\n\nДанные переданы рекрутёру.`
      );
    } catch (e) {
      console.error(e);
      await vk.sendMessage(
        peerId,
        'Не удалось вызвать GigaChat. Проверьте GIGACHAT_AUTH_KEY и сеть. Попробуйте позже или напишите ещё раз ответом текстом.'
      );
    }
    return;
  }

  if (session.stage === 'DONE') {
    await vk.sendMessage(peerId, 'Вы уже завершили анкету. Новый отклик — напишите /start');
    return;
  }
}

async function sendHardQuestion(vk, session) {
  const v = getVacancy(session.vacancyId);
  const q = v.hard[session.hardIndex];
  const { labels, correctIndex } = shuffleOptions(q.answers);
  session._currentCorrectPayload = `HARD:${session.hardIndex}:${correctIndex}`;

  const colors = ['primary', 'secondary', 'secondary', 'secondary'];
  const rows = labels.map((label, idx) => {
    const short = `${idx + 1}) ${label}`.replace(/\s+/g, ' ').slice(0, 38);
    return [
      {
        label: short,
        payload: JSON.stringify({ t: 'HARD', i: session.hardIndex, c: idx === correctIndex }),
        color: colors[idx] || 'secondary',
      },
    ];
  });

  await vk.sendMessage(
    session.peerId,
    `Вопрос ${session.hardIndex + 1}/5:\n${q.q}`,
    kbInline(rows)
  );
}

async function handleHardAnswer(vk, message, session) {
  let chosenCorrect = null;
  if (message.payload) {
    try {
      const p = JSON.parse(message.payload);
      if (p.t === 'HARD') chosenCorrect = !!p.c;
    } catch {
      chosenCorrect = null;
    }
  }
  if (chosenCorrect === null) {
    await vk.sendMessage(session.peerId, 'Выберите вариант кнопкой под вопросом.');
    return;
  }
  if (chosenCorrect) session.hardCorrect += 1;
  session.hardIndex += 1;
  if (session.hardIndex >= 5) {
    session.stage = 'SOFT';
    const v = getVacancy(session.vacancyId);
    await vk.sendMessage(
      session.peerId,
      `Вопрос 6 (Soft Skills, открытый кейс):\n${v.softCase}\n\nОтветьте одним сообщением текстом.`
    );
    return;
  }
  await sendHardQuestion(vk, session);
}

async function persistSession(session) {
  const v = getVacancy(session.vacancyId);
  const intent = session.intentId ? getIntent(session.intentId) : null;
  const skillsNote = intent?.skillsNote || '';

  let fit = { fitScore: 0, passed: false, missing: [], reason: '' };
  try {
    fit = await evaluateSkillFit(skillsNote, v.title, getRequiredSkillsDescription(session.vacancyId));
  } catch (e) {
    console.error('evaluateSkillFit', e);
    fit = { fitScore: 50, passed: true, missing: [], reason: 'GigaChat недоступен, воротники пропущены' };
  }

  const hard100 = scoreFromHard(session.hardCorrect);
  const soft100 = session.soft ? Math.min(100, Math.max(0, Math.round(session.soft.score * 10))) : 0;
  const motiv100 = motivationScore(session);
  const w = getWeights(session.vacancyId);
  let weightedScore = Math.round(w.hard * hard100 + w.soft * soft100 + w.motiv * motiv100);
  const skillGatePassed = Boolean(fit.passed);

  if (!skillGatePassed) {
    weightedScore = Math.min(weightedScore, Math.round(35 + fit.fitScore * 0.15));
  }

  upsertCandidate({
    vkUserId: session.userId,
    sessionId: session.sessionId,
    intentId: session.intentId || null,
    fio: intent?.fio || '',
    phone: intent?.phone || '',
    vacancyId: session.vacancyId,
    vacancyTitle: v.title,
    category: v.category,
    hardScore: session.hardCorrect,
    hardPct: hard100,
    softScore: soft100,
    motivationScore: motiv100,
    weightHard: Number(w.hard.toFixed(4)),
    weightSoft: Number(w.soft.toFixed(4)),
    weightMotiv: Number(w.motiv.toFixed(4)),
    weightedScore,
    skillGatePassed,
    skillFitScore: fit.fitScore,
    skillFitReason: fit.reason || '',
    skillFitMissing: fit.missing || [],
    polite: session.soft?.polite !== false && !session.soft?.toxic,
    toxic: !!session.soft?.toxic,
    aiVerdict: session.soft?.summary || '',
    aiScore: session.soft?.score || null,
    tags: getSkillTags(session.vacancyId),
    updatedAt: new Date().toISOString(),
  });
  return {
    hard100,
    soft100,
    motiv100,
    weightedScore,
    skillGatePassed,
    skillFitScore: fit.fitScore,
    skillFitReason: fit.reason,
    skillMissing: fit.missing,
  };
}

/** Сброс по команде /start */
export function resetSession(userId) {
  sessions.delete(userId);
}
