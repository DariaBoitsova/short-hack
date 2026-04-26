/**
 * Клиент GigaChat: OAuth (client credentials) + chat/completions.
 * Токены не хранятся в репозитории — только переменная окружения GIGACHAT_AUTH_KEY.
 */
import axios from 'axios';
import { randomUUID } from 'crypto';

const OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const CHAT_URL = 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions';

let cachedAccessToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  const authKey = process.env.GIGACHAT_AUTH_KEY;
  if (!authKey) throw new Error('Не задан GIGACHAT_AUTH_KEY в окружении');

  const now = Date.now();
  if (cachedAccessToken && now < tokenExpiresAt - 60_000) return cachedAccessToken;

  const rqUid = randomUUID();
  const { data } = await axios.post(
    OAUTH_URL,
    'scope=GIGACHAT_API_PERS',
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        RqUID: rqUid,
        Authorization: `Basic ${authKey}`,
        'User-Agent': 'hr-x5-ai-recruiting/1.0',
      },
      timeout: 45_000,
    }
  );

  cachedAccessToken = data.access_token;
  tokenExpiresAt = now + (data.expires_at ? data.expires_at * 1000 : 25 * 60 * 1000);
  return cachedAccessToken;
}

/**
 * Анализ ответа кандидата на открытый кейс (soft skills).
 * Возвращает распарсенный JSON с полями score, summary, polite, toxic.
 */
export async function analyzeSoftSkillsAnswer(userAnswer, vacancyTitle) {
  const token = await getAccessToken();

  const system = `Ты HR-аналитик X5 Group. Проанализируй ответ кандидата на кейс по направлению: «${vacancyTitle}».
Инструкция: оцени вежливость, уровень эмпатии и отсутствие токсичности. Оцени настрой кандидата.
Выдай СТРОГО JSON без markdown в формате:
{"score":число_1_10,"summary":"до 100 символов","polite":true/false,"toxic":true/false}
где polite=true если тон уважительный, toxic=true если есть оскорбления, агрессия или явный негатив к людям.`;

  const { data } = await axios.post(
    CHAT_URL,
    {
      model: 'GigaChat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userAnswer },
      ],
      temperature: 0.3,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'hr-x5-ai-recruiting/1.0',
      },
      timeout: 60_000,
    }
  );

  const raw = data?.choices?.[0]?.message?.content?.trim() || '';
  return parseGigaJson(raw);
}

function parseGigaJson(raw) {
  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  let cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  let parsed = tryParse(cleaned);
  if (parsed) return normalizeResult(parsed);

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    parsed = tryParse(match[0]);
    if (parsed) return normalizeResult(parsed);
  }

  return {
    score: 5,
    summary: raw.slice(0, 100),
    polite: true,
    toxic: false,
    raw,
  };
}

function normalizeResult(p) {
  const score = Math.min(10, Math.max(1, Number(p.score) || 5));
  const summary = String(p.summary || '').slice(0, 100);
  const polite = Boolean(p.polite !== false && !p.toxic);
  const toxic = Boolean(p.toxic === true);
  return { score, summary, polite, toxic };
}

/**
 * Проверка текста навыков/резюме на соответствие обязательным компетенциям вакансии.
 * Используется для отсечения кандидатов без ключевых тегов из топа.
 */
export async function evaluateSkillFit(skillsText, vacancyTitle, requiredDescription) {
  const token = await getAccessToken();
  const text = String(skillsText || '').trim();
  if (text.length < 2) {
    return {
      fitScore: 12,
      passed: false,
      missing: ['Навыки и опыт не заполнены в анкете'],
      reason: 'Нет текста для сопоставления с требованиями вакансии',
    };
  }

  const system = `Ты рекрутер X5 Group. Вакансия/направление: «${vacancyTitle}».
Критичные компетенции для этой роли (должны прослеживаться в тексте кандидата): ${requiredDescription}

Текст кандидата (навыки, стек, опыт из анкеты): """${text.slice(0, 3500)}"""

Задача: определи, есть ли ЯВНЫЕ признаки нужных компетенций (ключевые слова, стек, опыт). Если важное для роли не упомянуто (например Python для Python-разработчика) — passed=false.
Ответь СТРОГО JSON без markdown:
{"fitScore":число_0_100,"passed":true_или_false,"missing":["кратко что не хватает"],"reason":"до 140 символов"}
passed=true только если fitScore>=58 и критичные зоны для роли покрыты.`;

  const { data } = await axios.post(
    CHAT_URL,
    {
      model: 'GigaChat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: 'Проанализируй соответствие.' },
      ],
      temperature: 0.2,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'hr-x5-ai-recruiting/1.0',
      },
      timeout: 60_000,
    }
  );

  const raw = data?.choices?.[0]?.message?.content?.trim() || '';
  return parseFitJson(raw);
}

function parseFitJson(raw) {
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  let p;
  try {
    p = JSON.parse(cleaned.match(/\{[\s\S]*\}/)?.[0] || cleaned);
  } catch {
    p = {};
  }
  const fitScore = Math.min(100, Math.max(0, Number(p.fitScore) || 0));
  const passed = fitScore >= 58 && p.passed !== false;
  const missing = Array.isArray(p.missing) ? p.missing.map(String).slice(0, 5) : [];
  const reason = String(p.reason || '').slice(0, 140);
  return { fitScore, passed, missing, reason };
}
