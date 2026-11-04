import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from "tiktok-live-connector";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const TIKTOK_USERNAME = (process.env.TIKTOK_USERNAME || "").replace(/^@/, "").trim();
const CHICKEN_GIFTS = new Set(csv(process.env.CHICKEN_GIFTS || "Rose"));
const FOX_GIFTS = new Set(csv(process.env.FOX_GIFTS || "Fox"));
const EGG_GIFTS = new Set(csv(process.env.EGG_GIFTS || "Heart Me"));
const BIG_GIFT_MIN = Math.max(1, Number(process.env.BIG_GIFT_MIN || 1000));

function csv(value) {
  return value.split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
}

const app = express();
app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("/health", (_req, res) => res.json({
  ok: true,
  service: "tavuk-ciftligi-live",
  tiktokConfigured: Boolean(TIKTOK_USERNAME),
  tiktokConnected: Boolean(liveConnection?.isConnected)
}));
app.get("/api/status", (_req, res) => res.json({
  tiktokUsername: TIKTOK_USERNAME ? `@${TIKTOK_USERNAME}` : null,
  configured: Boolean(TIKTOK_USERNAME),
  connected: Boolean(liveConnection?.isConnected)
}));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
let liveConnection = null;
let reconnectLoopRunning = false;
let stopping = false;
let lastError = "";

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

function statusNotice(connected, message = "") {
  broadcast({ type: "status", connected, message });
  if (message) console.log(`[LIVE] ${message}`);
}

wss.on("connection", (socket) => {
  socket.on("message", () => { /* Browser keepalive; no commands accepted. */ });
  socket.send(JSON.stringify({
    type: "status",
    connected: Boolean(liveConnection?.isConnected),
    message: lastError
  }));
});

function getGiftName(data) {
  return String(
    data.extendedGiftInfo?.name ||
    data.giftDetails?.giftName ||
    data.giftName ||
    data.extendedGiftInfo?.giftName ||
    ""
  ).trim();
}

function getGiftValue(data) {
  const details = data.giftDetails || {};
  const extended = data.extendedGiftInfo || {};
  const unitValue = Number(
    extended.diamondCount ??
    details.diamondCount ??
    data.diamondCount ??
    data.gift?.diamondCount ??
    0
  );
  const repeatCount = Math.max(1, Number(data.repeatCount || 1));
  // Gift ranking uses the total value of this one completed gift event,
  // not the viewer's cumulative spending across the stream.
  return Math.max(0, unitValue * repeatCount);
}

function handleGift(data) {
  // Streakable gifts emit interim updates and a final repeatEnd event.
  if (Number(data.giftDetails?.giftType ?? data.giftType) === 1 && data.repeatEnd !== true) {
    return;
  }

  const username = String(data.user?.uniqueId || data.user?.nickname || "izleyici")
    .replace(/^@/, "").slice(0, 40);
  const giftName = getGiftName(data);
  const giftNameKey = giftName.toLowerCase();
  const giftValue = getGiftValue(data);
  const repeatCount = Math.max(1, Number(data.repeatCount || 1));

  let type = null;
  if (FOX_GIFTS.has(giftNameKey)) type = "fox";
  else if (CHICKEN_GIFTS.has(giftNameKey)) type = "chicken";
  else if (EGG_GIFTS.has(giftNameKey)) type = "egg";
  else if (giftValue >= BIG_GIFT_MIN) type = "big";

  console.log(`[GIFT] @${username} · ${giftName || "Bilinmeyen hediye"} · ${giftValue} elmas · ${repeatCount} adet · ${type || "eşleşme yok"}`);
  if (type) {
    broadcast({
      type: "gift",
      eventId: `${data.msgId || data.common?.msgId || Date.now()}-${data.giftId || "gift"}`,
      username,
      giftName,
      giftValue,
      repeatCount,
      type,
      receivedAt: new Date().toISOString()
    });
  }
}

async function connectLoop() {
  if (reconnectLoopRunning || !TIKTOK_USERNAME) return;
  reconnectLoopRunning = true;
  let delay = 3000;

  while (!stopping) {
    try {
      console.log(`[LIVE] @${TIKTOK_USERNAME} yayınına bağlanılıyor...`);
      const connection = new TikTokLiveConnection(TIKTOK_USERNAME, {
        enableExtendedGiftInfo: true,
        processInitialData: false,
        fetchRoomInfoOnConnect: true
      });
      liveConnection = connection;

      connection.on(WebcastEvent.GIFT, handleGift);
      connection.on(ControlEvent.CONNECTED, () => {
        delay = 3000;
        lastError = "";
        statusNotice(true, `@${TIKTOK_USERNAME} LIVE bağlantısı kuruldu`);
      });
      connection.on(ControlEvent.DISCONNECTED, (event) => {
        statusNotice(false, `TikTok bağlantısı kapandı: ${event?.reason || "bağlantı kesildi"}`);
      });
      connection.on(ControlEvent.ERROR, (error) => {
        lastError = String(error?.message || error);
        console.error("[LIVE] Connector hatası:", lastError);
      });

      await connection.connect();
      delay = 3000;

      // Wait until the socket disconnects; the outer loop owns reconnection.
      while (!stopping && connection.isConnected) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      lastError = String(error?.message || error);
      console.error("[LIVE] Bağlantı kurulamadı:", lastError);
      statusNotice(false, lastError);
    } finally {
      const oldConnection = liveConnection;
      liveConnection = null;
      if (oldConnection) {
        try { await oldConnection.disconnect(); } catch (_) {}
      }
      statusNotice(false, "Yeniden bağlanma bekleniyor");
    }

    if (!stopping) {
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(Math.round(delay * 1.7), 60000);
    }
  }
  reconnectLoopRunning = false;
}

server.listen(PORT, () => {
  console.log(`Çiftlik LIVE sunucusu ${PORT} portunda hazır.`);
  if (!TIKTOK_USERNAME) {
    console.warn("TIKTOK_USERNAME tanımlı değil. Sunucu ve arayüz hazır; TikTok bağlantısı başlatılmadı.");
  } else {
    connectLoop();
  }
});

async function shutdown() {
  stopping = true;
  try { await liveConnection?.disconnect(); } catch (_) {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
