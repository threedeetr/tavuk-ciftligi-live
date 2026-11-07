import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { TikTokLiveClient, EventType } from 'piratetok-live-js';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const PORT = Number(process.env.PORT || 3000);
const USERNAME = String(process.env.TIKTOK_USERNAME || 'threedee.tr').replace(/^@/, '').trim();
const FOX_GIFTS = giftSet(process.env.FOX_GIFTS || 'Paw');
const EGG_GIFTS = giftSet(process.env.EGG_GIFTS || 'Heart Me');
const BIG_GIFT_MIN = Number(process.env.BIG_GIFT_MIN || 100);
const BAN_MS = 30 * 60 * 1000;
const SAVE_FILE = process.env.FARM_DATA_FILE || path.join(root, 'farm-state.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function giftSet(value) { return new Set(String(value).toLowerCase().split(',').map(s => s.trim()).filter(Boolean)); }
function cleanName(value) { return String(value || 'izleyici').replace(/^@+/, '').trim().slice(0, 32) || 'izleyici'; }
function cleanMessage(value) { return String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100); }
function randomItem(list) { return list[Math.floor(Math.random() * list.length)]; }
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

const state = {
  chickens: [], bans: {}, babySerial: 0,
  owner: null, bestGiftValue: 0,
  goal: { level: 1, target: 1000, progress: 0, completed: false, nextAt: 0 },
  connected: false, status: 'TikTok LIVE bekleniyor',
  eventSerial: 0
};
try {
  const saved = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
  if (Array.isArray(saved.chickens)) state.chickens = saved.chickens;
  if (saved.bans && typeof saved.bans === 'object') state.bans = saved.bans;
  if (Number.isInteger(saved.babySerial)) state.babySerial = saved.babySerial;
  if (saved.goal && typeof saved.goal === 'object') Object.assign(state.goal, saved.goal);
  if (typeof saved.owner === 'string' || saved.owner === null) state.owner = saved.owner;
  if (Number.isFinite(saved.bestGiftValue)) state.bestGiftValue = saved.bestGiftValue;
  console.log('[SAVE] Çiftlik verileri yüklendi');
} catch (e) { if (e.code !== 'ENOENT') console.warn('[SAVE]', e.message); }
let dirty = false;
function persist() {
  if (!dirty) return;
  try {
    const tmp = SAVE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ chickens: state.chickens, bans: state.bans, babySerial: state.babySerial, owner: state.owner, bestGiftValue: state.bestGiftValue, goal: state.goal }));
    fs.renameSync(tmp, SAVE_FILE);
    dirty = false;
  } catch (e) { console.warn('[SAVE] Kaydedilemedi:', e.message); }
}
function markDirty() { dirty = true; }
setInterval(persist, 10000);
function emit(type, payload = {}) {
  const message = JSON.stringify({ type, ...payload });
  for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(message);
}
function snapshot() {
  return { type: 'snapshot', chickens: state.chickens, bans: state.bans, babySerial: state.babySerial, owner: state.owner, bestGiftValue: state.bestGiftValue, goal: state.goal, connected: state.connected, status: state.status };
}
function status(message, connected = false) {
  state.status = message; state.connected = connected;
  console.log('[LIVE]', message);
  emit('status', { message, connected });
}
function publicChicken(c) { return { id: c.id, username: c.username, message: c.message, bornAt: c.bornAt, baby: c.baby }; }
function addChicken(username, message = '', baby = false) {
  const c = { id: uid(), username, message, bornAt: Date.now(), baby };
  state.chickens.push(c);
  markDirty();
  emit('chicken-added', { chicken: publicChicken(c) });
  return c;
}
function chatHandler(event) {
  const d = event?.data || event || {};
  const username = cleanName(d.user?.uniqueId || d.uniqueId || d.user?.nickname || d.nickname);
  const message = cleanMessage(d.comment ?? d.message ?? d.text ?? '');
  if (!message || username === 'izleyici') return;
  const key = username.toLowerCase();
  if (state.bans[key] && state.bans[key] > Date.now()) return;
  if (state.bans[key]) { delete state.bans[key]; markDirty(); }
  let c = state.chickens.find(x => !x.baby && x.username.toLowerCase() === key);
  if (!c) {
    c = addChicken(username, message);
    emit('notice', { message: `🐔 @${username} kümese katıldı!` });
  } else {
    c.message = message;
    markDirty();
    emit('chicken-message', { id: c.id, message });
  }
}
function foxAttack(sender) {
  if (!state.chickens.length) {
    emit('notice', { message: `🦊 @${sender} tilki saldı ama kümes boş!` });
    return;
  }
  const victim = randomItem(state.chickens);
  state.chickens = state.chickens.filter(c => c.id !== victim.id);
  // İsimsiz doğan tavukların geri dönüşü yoktur; izleyiciler 30 dakika engellenir.
  if (!victim.baby) state.bans[victim.username.toLowerCase()] = Date.now() + BAN_MS;
  markDirty();
  emit('fox-attack', { sender, victimId: victim.id, victimName: victim.username, bannedUntil: victim.baby ? null : state.bans[victim.username.toLowerCase()] });
  emit('notice', { message: `🦊 @${sender} tilki saldı! ${victim.username} yakalandı${victim.baby ? '!' : ' — 30 dakika kümese giremez!'}` });
}
function mating(sender) {
  if (state.chickens.length < 2) {
    emit('notice', { message: '❤️ Çiftleşme için kümeste en az iki tavuk olmalı!' });
    return;
  }
  const first = randomItem(state.chickens);
  const second = randomItem(state.chickens.filter(c => c.id !== first.id));
  const babyName = `İsimsiz${++state.babySerial}`;
  markDirty();
  emit('mating', { first: first.username, second: second.username, sender, babyName });
  setTimeout(() => {
    addChicken(babyName, '🐣 Yeni doğdum!', true);
    emit('notice', { message: `🐣 ${babyName} dünyaya geldi!` });
  }, 3000);
}
function addGoalPoints(points) {
  if (state.goal.completed) return;
  const amount = Math.max(0, Math.floor(Number(points) || 0));
  if (!amount) return;
  state.goal.progress = Math.min(state.goal.target, state.goal.progress + amount);
  if (state.goal.progress >= state.goal.target) {
    state.goal.completed = true;
    state.goal.nextAt = Date.now() + 5000;
    emit('notice', { message: '🎉 Çiftliğin borcu ödendi! Yeni borç geliyor!' });
  }
  markDirty();
  emit('goal', { goal: state.goal });
}
setInterval(() => {
  const now = Date.now();
  if (state.goal.completed && now >= state.goal.nextAt) {
    state.goal.level++;
    state.goal.target = Math.min(state.goal.target * 2, 1000000000);
    state.goal.progress = 0;
    state.goal.completed = false;
    state.goal.nextAt = 0;
    markDirty();
    emit('goal', { goal: state.goal });
  }
  for (const [name, until] of Object.entries(state.bans)) if (until <= now) { delete state.bans[name]; markDirty(); }
}, 1000);
const seen = new Map();
function giftHandler(event) {
  const d = event?.data || event || {};
  const gift = d.gift || {};
  const giftName = String(gift.name || d.giftName || '').trim();
  const sender = cleanName(d.user?.uniqueId || d.uniqueId || d.user?.nickname || d.nickname);
  const count = Math.max(1, Number(d.repeatCount || 1));
  const value = Math.max(0, Number(gift.diamondCount ?? d.diamondCount ?? 0)) * count;
  if ((d.isCombo === true || Number(gift.giftType ?? d.giftType) === 1) && d.isStreakOver !== true && d.repeatEnd !== true) return;
  const id = String(d.msgId || d.messageId || d.id || '');
  const key = id ? `${id}:${sender}:${giftName}:${count}` : '';
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > 120000) seen.delete(k);
  if (key && seen.has(key)) return;
  if (key) seen.set(key, now);
  addGoalPoints(value);
  const name = giftName.toLowerCase();
  console.log(`[GIFT] @${sender}: ${giftName} x${count} (${value} elmas)`);
  if (FOX_GIFTS.has(name)) foxAttack(sender);
  else if (EGG_GIFTS.has(name)) mating(sender);
  else if (value >= BIG_GIFT_MIN) {
    if (value > state.bestGiftValue) {
      state.bestGiftValue = value;
      state.owner = sender;
      markDirty();
      emit('owner', { owner: sender, bestGiftValue: value });
      emit('notice', { message: `👑 @${sender} çiftliğin yeni sahibi oldu!` });
    }
  }
}
app.disable('x-powered-by');
app.use(express.static(path.join(root, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, connected: state.connected, chickens: state.chickens.length }));
app.get('/api/status', (_req, res) => res.json({ tiktokUsername: '@' + USERNAME, connected: state.connected, status: state.status, chickens: state.chickens.length }));
wss.on('connection', socket => {
  socket.send(JSON.stringify(snapshot()));
  socket.on('message', () => {});
});
let client = null;
let stopping = false;
async function connectForever() {
  let wait = 5000;
  while (!stopping) {
    try {
      status(`@${USERNAME} yayını aranıyor...`);
      client = new TikTokLiveClient(USERNAME).maxRetries(10);
      client.on(EventType.gift, giftHandler);
      client.on('chat', chatHandler);
      client.on('disconnected', () => status('TikTok bağlantısı kesildi'));
      client.on('liveEnded', () => status('Canlı yayın sona erdi'));
      await client.connect();
      status(`@${USERNAME} LIVE bağlı`, true);
      wait = 5000;
      while (!stopping && state.connected) await sleep(2000);
    } catch (error) {
      console.error('[LIVE]', error?.message || error);
      status(`TikTok LIVE bekleniyor: ${error?.message || error}`);
    } finally {
      try { await client?.disconnect(); } catch {}
      client = null;
      state.connected = false;
    }
    if (!stopping) { await sleep(wait); wait = Math.min(Math.round(wait * 1.6), 60000); }
  }
}
server.listen(PORT, () => { console.log(`Çiftlik LIVE ${PORT} portunda`); connectForever(); });
function shutdown() { stopping = true; persist(); try { client?.disconnect(); } catch {} server.close(); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
