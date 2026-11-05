
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

const app = express();
const port = Number(process.env.PORT || 3000);
const username = String(process.env.TIKTOK_USERNAME || '').replace(/^@/, '').trim();
const apiKey = String(process.env.TIKTOOL_API_KEY || '').trim();

function csv(s) {
  return new Set(s.split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
}

const chicken = csv(process.env.CHICKEN_GIFTS || 'Rose');
const fox = csv(process.env.FOX_GIFTS || 'Fox');
const egg = csv(process.env.EGG_GIFTS || 'Heart Me');
const bigMin = Number(process.env.BIG_GIFT_MIN || 1000);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const dir = path.dirname(fileURLToPath(import.meta.url));
app.disable('x-powered-by');
app.use(express.static(path.join(dir, 'public'), { extensions: ['html'] }));

let upstream = null;
let connected = false;
let lastError = '';
let stopping = false;

const server = http.createServer(app);
const clients = new WebSocketServer({ server, path: '/ws' });

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of clients.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

function status(message, isConnected = false) {
  connected = isConnected;
  broadcast({ type: 'status', connected, message });
  console.log('[LIVE]', message);
}

clients.on('connection', socket => {
  socket.on('message', () => {});
  socket.send(JSON.stringify({
    type: 'status',
    connected,
    message: connected ? 'Tik.Tools LIVE bağlı' : lastError || 'TikTok LIVE bekleniyor'
  }));
});

app.get('/health', (_req, res) => res.json({
  ok: true,
  configured: !!(username && apiKey),
  connected
}));

app.get('/api/status', (_req, res) => res.json({
  tiktokUsername: username ? '@' + username : null,
  configured: !!(username && apiKey),
  connected,
  lastError
}));

const combos = new Map();
const seen = new Map();

function handleGift(d) {
  const sender = String(
    d.user?.uniqueId || d.user?.nickname || d.user_unique_id || 'izleyici'
  ).replace(/^@/, '').slice(0, 40);

  const name = String(d.giftName || '').trim();
  const key = name.toLowerCase();
  const unit = Math.max(0, Number(d.diamondCount || 0));
  const count = Math.max(1, Number(d.repeatCount || 1));
  const giftId = String(d.giftId || name);
  const now = Date.now();

  for (const [k, v] of combos) {
    if (now - v.at > 120000) combos.delete(k);
  }

  for (const [k, at] of seen) {
    if (now - at > 120000) seen.delete(k);
  }

  const transaction = String(d.transactionId || d.msgId || '');
  const exact = transaction
    ? transaction + ':' + count + ':' + sender + ':' + giftId
    : '';

  if (exact && seen.has(exact)) return;
  if (exact) seen.set(exact, now);

  let quantity = count;

  if (Number(d.giftType) === 1 || d.groupId) {
    const group = String(d.groupId || sender + ':' + giftId);
    const id = sender + ':' + giftId + ':' + group;
    const prev = combos.get(id)?.count || 0;

    quantity = Math.max(0, count - prev);
    combos.set(id, {
      count: Math.max(count, prev),
      at: now
    });

    if (!quantity) return;
  }

  const value = unit * quantity;
  const type = fox.has(key)
    ? 'fox'
    : chicken.has(key)
      ? 'chicken'
      : egg.has(key)
        ? 'egg'
        : value >= bigMin
          ? 'big'
          : null;

  console.log(
    `[GIFT] @${sender} ${name} x${quantity} (${value} elmas) -> ${type || 'eşleşme yok'}`
  );

  if (type) {
    broadcast({
      type: 'gift',
      username: sender,
      giftName: name,
      giftValue: value,
      repeatCount: quantity,
      type,
      eventId: exact || `${now}-${sender}-${giftId}`,
      receivedAt: new Date().toISOString()
    });
  }
}

async function run() {
  if (!username || !apiKey) {
    lastError = !apiKey
      ? 'TIKTOOL_API_KEY eksik'
      : 'TIKTOK_USERNAME eksik';

    status(lastError);
    return;
  }

  let delay = 3000;

  while (!stopping) {
    let socket;

    try {
      status(`@${username} Tik.Tools bağlantısı deneniyor`);

      const url = new URL('wss://api.tik.tools');
      url.searchParams.set('uniqueId', username);
      url.searchParams.set('apiKey', apiKey);

      socket = new WebSocket(url.toString(), {
        handshakeTimeout: 20000
      });

      upstream = socket;

      await new Promise((resolve, reject) => {
        let settled = false;

        const finish = err => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          err ? reject(err) : resolve();
        };

        const timeout = setTimeout(() => {
          socket.terminate();
          finish(new Error('Tik.Tools bağlantı zaman aşımı'));
        }, 30000);

        socket.on('open', () => {
          lastError = '';
          delay = 3000;
          status(`@${username} Tik.Tools soketi açıldı`, true);
        });

        socket.on('message', raw => {
          let msg;

          try {
            msg = JSON.parse(raw.toString());
          } catch {
            return;
          }

          if (msg.event === 'roomInfo') {
            status(`@${username} TikTok LIVE bağlı`, true);
          } else if (msg.event === 'gift') {
            handleGift(msg.data || {});
          } else if (
            msg.event === 'error' ||
            msg.event === 'connectionError'
          ) {
            lastError = String(
              msg.data?.message ||
              msg.message ||
              JSON.stringify(msg.data || msg)
            ).slice(0, 250);

            console.error('[LIVE] Tik.Tools:', lastError);
            status(lastError, false);
          } else if (
            msg.event === 'streamEnd' ||
            msg.event === 'liveEnd'
          ) {
            status('Canlı yayın sona erdi', false);
          }
        });

        socket.on('error', e => {
          lastError = e.message;
          console.error('[LIVE] WS:', lastError);
          finish(e);
        });

        socket.on('close', (code, reason) => {
          const why = reason?.toString().slice(0, 180) ||
            'neden belirtilmedi';

          lastError = `Bağlantı kapandı (${code}): ${why}`;
          status(lastError, false);
          finish();
        });
      });
    } catch (e) {
      lastError = String(e.message || e).slice(0, 250);
      status('Bağlantı kurulamadı: ' + lastError, false);
    } finally {
      connected = false;

      if (socket && socket.readyState !== WebSocket.CLOSED) {
        socket.terminate();
      }

      if (upstream === socket) upstream = null;
    }

    if (!stopping) {
      status(
        `Yeniden bağlanma ${Math.round(delay / 1000)} sn sonra`,
        false
      );

      await sleep(delay);
      delay = Math.min(Math.round(delay * 1.7), 60000);
    }
  }
}

server.listen(port, () => {
  console.log(`Tavuk Çiftliği ${port} portunda hazır`);
  run();
});

function shutdown() {
  stopping = true;
  upstream?.terminate();
  server.close();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
