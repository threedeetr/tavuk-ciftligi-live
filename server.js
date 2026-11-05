
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { TikTokLiveClient, EventType } from 'piratetok-live-js';

const app = express();
const port = Number(process.env.PORT || 3000);
const username = String(
  process.env.TIKTOK_USERNAME || 'threedee.tr'
).replace(/^@/, '').trim();

const directory = path.dirname(fileURLToPath(import.meta.url));

const giftSet = name => new Set(
  String(name).toLowerCase().split(',')
    .map(x => x.trim()).filter(Boolean)
);

const chickenGifts = giftSet(process.env.CHICKEN_GIFTS || 'Rose');
const foxGifts = giftSet(process.env.FOX_GIFTS || 'Fox');
const eggGifts = giftSet(process.env.EGG_GIFTS || 'Heart Me');
const bigGiftMin = Number(process.env.BIG_GIFT_MIN || 1000);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

app.disable('x-powered-by');
app.use(express.static(path.join(directory, 'public'), {
  extensions: ['html']
}));

let connected = false;
let lastError = '';
let client = null;
let stopping = false;

const server = http.createServer(app);
const browserSockets = new WebSocketServer({
  server,
  path: '/ws'
});

function broadcast(payload) {
  const json = JSON.stringify(payload);
  for (const socket of browserSockets.clients) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(json);
    }
  }
}

function status(message, isConnected = false) {
  connected = isConnected;
  console.log('[LIVE]', message);
  broadcast({ type: 'status', connected, message });
}

browserSockets.on('connection', socket => {
  socket.on('message', () => {});
socket.send(JSON.stringify(goalSnapshot()));
  socket.send(JSON.stringify({
    type: 'status',
    connected,
    message: connected
      ? `@${username} LIVE bağlı`
      : lastError || 'TikTok LIVE bekleniyor'
  }));
});

app.get('/health', (_req, res) => res.json({
  ok: true,
  configured: !!username,
  connected
}));

app.get('/api/status', (_req, res) => res.json({
  tiktokUsername: `@${username}`,
  configured: !!username,
  connected,
  lastError
}));


const farmMissions = [
  '🏚️ Çiftliğin borcunu öde!'
];

const goal = {
  level: 1,
  target: 1000,
  progress: 0,
  title: farmMissions[0],
  completed: false,
  nextAt: 0
};

function goalSnapshot() {
  return { type: 'goal', ...goal };
}

function publishGoal() {
  broadcast(goalSnapshot());
}

function nextFarmGoal() {
  goal.level++;
  goal.target = Math.min(goal.target * 2, 1000000000);
  goal.progress = 0;
  goal.completed = false;
  goal.nextAt = 0;
  goal.title = '🏚️ Çiftliğin borcunu öde!';

  publishGoal();
}

function addGoalPoints(points) {
  if (goal.completed) return;

  const amount = Math.max(0, Math.floor(Number(points) || 0));
  if (!amount) return;

  goal.progress = Math.min(
    goal.target,
    goal.progress + amount
  );

  if (goal.progress >= goal.target) {
    goal.completed = true;
    goal.nextAt = Date.now() + 5000;
  }

  publishGoal();
}

// Tamamlanan hedefi sunucu otomatik ilerletir.
setInterval(() => {
  if (goal.completed && Date.now() >= goal.nextAt) {
    nextFarmGoal();
  }
}, 1000);

const recentlySeen = new Map();

const recentViewers = new Map();

function rememberViewer(username) {
  const name = String(username || '').replace(/^@/, '').slice(0, 40);
  if (!name || name === 'izleyici') return;

  recentViewers.delete(name);
  recentViewers.set(name, Date.now());

  while (recentViewers.size > 200) {
    recentViewers.delete(recentViewers.keys().next().value);
  }
}

function randomViewer(fallback) {
  const now = Date.now();
  const viewers = [...recentViewers]
    .filter(([name, time]) => now - time < 30 * 60 * 1000)
    .map(([name]) => name);

  return viewers.length
    ? viewers[Math.floor(Math.random() * viewers.length)]
    : fallback;
}

function handleGift(event) {
  const data = event?.data || event;
  const gift = data?.gift || {};

  const giftName = String(
    gift.name || data?.giftName || ''
  ).trim();

  const sender = String(
    data?.user?.uniqueId ||
    data?.user?.nickname ||
    'izleyici'
  ).replace(/^@/, '').slice(0, 40);

  rememberViewer(sender);

  const unitDiamonds = Math.max(
    0,
    Number(gift.diamondCount ?? data?.diamondCount ?? 0)
  );

  const count = Math.max(1, Number(data?.repeatCount || 1));
  const giftValue = unitDiamonds * count;
  const key = giftName.toLowerCase();

  if (
    (data?.isCombo === true ||
      Number(gift.giftType ?? data?.giftType) === 1) &&
    data?.isStreakOver !== true &&
    data?.repeatEnd !== true
  ) {
    return;
  }

  const eventId = String(
    data?.msgId || data?.messageId || data?.id || ''
  );

  const dedupKey = eventId
    ? `${eventId}:${sender}:${giftName}:${count}`
    : '';

  const now = Date.now();

  for (const [id, time] of recentlySeen) {
    if (now - time > 120000) recentlySeen.delete(id);
  }

  if (dedupKey && recentlySeen.has(dedupKey)) return;
  if (dedupKey) recentlySeen.set(dedupKey, now);
addGoalPoints(giftValue);
  const type = foxGifts.has(key)
    ? 'fox'
    : chickenGifts.has(key)
      ? 'chicken'
      : eggGifts.has(key)
        ? 'egg'
        : giftValue >= bigGiftMin
          ? 'big'
          : null;

  console.log(
    `[GIFT] @${sender}: ${giftName} x${count} (${giftValue} elmas) => ${type || 'eşleşme yok'}`
  );

  if (type) {
    broadcast({
      type: 'gift',
      eventId: dedupKey || `${now}-${sender}-${key}`,
      username: sender,
      giftName,
      giftValue,
      repeatCount: count,
      giftType: type,
      babyUsername: type === 'egg' ? randomViewer(sender) : null,
      receivedAt: new Date().toISOString()
    });
  }
}

async function connectForever() {
  let wait = 5000;

  while (!stopping) {
    try {
      status(`@${username} yayını aranıyor...`);

      client = new TikTokLiveClient(username).maxRetries(10);

      client.on(EventType.gift, handleGift);


client.on('chat', event => {
  const data = event?.data || event;
  rememberViewer(
    data?.user?.uniqueId ||
    data?.uniqueId ||
    data?.user?.nickname
  );
});

      client.on('reconnecting', () => {
        console.log('[LIVE] TikTok yeniden bağlanıyor');
      });

      client.on('disconnected', () => {
        status('TikTok bağlantısı kesildi');
      });

      client.on('liveEnded', () => {
        status('Canlı yayın sona erdi');
      });

      await client.connect();

      lastError = '';
      status(`@${username} LIVE bağlı`, true);
      wait = 5000;

      while (!stopping && connected) {
        await sleep(2000);
      }
    } catch (error) {
      lastError = String(error?.message || error);
      console.error('[LIVE] Bağlantı hatası:', lastError);
      status(`TikTok LIVE bekleniyor: ${lastError}`);
    } finally {
      try {
        await client?.disconnect();
      } catch {}

      client = null;
      connected = false;
    }

    if (!stopping) {
      await sleep(wait);
      wait = Math.min(Math.round(wait * 1.6), 60000);
    }
  }
}

server.listen(port, () => {
  console.log(`Tavuk Çiftliği sunucusu ${port} portunda hazır`);
  connectForever();
});

function shutdown() {
  stopping = true;
  try {
    client?.disconnect();
  } catch {}
  server.close();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
