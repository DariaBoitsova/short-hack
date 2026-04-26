/**
 * Точка входа: Express (API для админки) + VK Long Poll через vk-io.
 * Запуск из корня: node bot/server.js
 */
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { VK } from 'vk-io';
import { handleIncomingMessage, resetSession } from './vk-bot.js';
import { readCandidates } from './storage.js';
import { saveIntent } from './intent-storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');

const PORT = Number(process.env.PORT || 3780);
const VK_TOKEN = process.env.VK_GROUP_TOKEN;
const VK_GROUP_ID = process.env.VK_GROUP_ID;

const app = express();
app.use(express.json());
app.use(express.static(publicDir));

app.get('/api/candidates', (req, res) => {
  res.json(readCandidates());
});

app.get('/api/health', (_, res) => {
  res.json({ ok: true, hasVk: !!VK_TOKEN, hasGiga: !!process.env.GIGACHAT_AUTH_KEY });
});

/** Сохранение анкеты с лендинга перед переходом в VK */
app.post('/api/intent', (req, res) => {
  const { intentId, fio, phone, vacancyId, vacancyTitle, category, skillsNote } = req.body || {};
  if (!intentId || !vacancyId) return res.status(400).json({ error: 'intentId и vacancyId обязательны' });
  saveIntent({
    intentId,
    fio: fio || '',
    phone: phone || '',
    vacancyId,
    vacancyTitle: vacancyTitle || '',
    category: category || '',
    skillsNote: String(skillsNote || '').slice(0, 4000),
  });
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`HTTP: http://localhost:${PORT}`);
});

if (!VK_TOKEN || !VK_GROUP_ID) {
  console.warn('VK_GROUP_TOKEN или VK_GROUP_ID не заданы — работает только статика/API.');
} else {
  const vk = new VK({ token: VK_TOKEN, apiVersion: '5.131' });

  /** Пользователь разрешил сообщения сообществу — приветствие (снимает «молчание» после подписки). */
  vk.updates.on('message_allow', async (ctx) => {
    try {
      await ctx.send(
        'Здравствуйте! Вы в AI-рекрутинге X5.\nЕсли ранее появлялось «ограничен круг лиц» — в настройках сообщества должны быть открыты входящие от пользователей.\nНапишите номер направления 1–18 или перейдите по ссылке с сайта ещё раз.'
      );
    } catch (e) {
      console.error('message_allow', e);
    }
  });

  vk.updates.on('message_new', async (ctx, next) => {
    if (ctx.isOutbox) return next();

    const text = (ctx.text || '').trim();
    if (/^\/start$/i.test(text)) {
      resetSession(ctx.senderId);
      await ctx.send(
        'Сессия сброшена. Напишите цифру направления 1–18 или откройте бота снова с лендинга X5.'
      );
      return next();
    }

    const msg = ctx.message;
    const payloadObj = ctx.messagePayload || msg.payload;
    const payloadStr =
      typeof payloadObj === 'object' && payloadObj !== null ? JSON.stringify(payloadObj) : payloadObj || undefined;

    const ref = msg.ref || ctx.startPayload || undefined;

    const fakeVk = {
      sendMessage: async (peerId, message, keyboard) => {
        await vk.api.messages.send({
          peer_id: peerId,
          message,
          random_id: Date.now(),
          ...(keyboard ? { keyboard } : {}),
        });
      },
    };

    await handleIncomingMessage(fakeVk, {
      peer_id: ctx.peerId,
      from_id: ctx.senderId,
      text: msg.text || '',
      payload: payloadStr,
      ref,
    });
    return next();
  });

  vk.updates.start().then(() => console.log('VK Long Poll запущен')).catch(console.error);
}
