import http from "http";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import express from "express";
import dotenv from "dotenv";
import { WebSocketServer } from "ws";
import { LIMITS, publicConfig } from "./src/config.js";
import { exchangeCodeForToken, proxyDiscordAvatar } from "./src/discordAuth.js";
import { RoomManager } from "./src/rooms.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const MAPS_DIR = path.join(PUBLIC_DIR, "maps");
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 3000;

fs.mkdirSync(MAPS_DIR, { recursive: true });

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "32kb" }));

app.use((req, _res, next) => {
  if (req.url.startsWith("/.proxy/")) req.url = req.url.slice("/.proxy".length) || "/";
  else if (req.url === "/.proxy") req.url = "/";
  next();
});

app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "frame-ancestors https://discord.com https://*.discord.com https://discordapp.com https://*.discordapp.com;",
  );
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.rooms.size });
});

app.get("/api/config", (_req, res) => {
  res.json(publicConfig(MAPS_DIR));
});

app.post("/api/token", async (req, res) => {
  try {
    const result = await exchangeCodeForToken(req.body?.code);
    res.json({ access_token: result.access_token });
  } catch (err) {
    console.error("[oauth]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get("/api/avatar/:id/:hash", async (req, res) => {
  try {
    const file = await proxyDiscordAvatar(req.params.id, req.params.hash);
    if (!file) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(file.buffer);
  } catch (err) {
    res.status(502).json({ error: "avatar proxy failed" });
  }
});

app.use(
  express.static(PUBLIC_DIR, {
    etag: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }),
);

app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  if (
    req.path.startsWith("/api") ||
    req.path.startsWith("/ws") ||
    req.path.startsWith("/maps/") ||
    req.path.startsWith("/js/") ||
    req.path.startsWith("/style")
  ) {
    res.status(404).end();
    return;
  }
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

const server = http.createServer(app);
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: LIMITS.maxPayloadBytes,
});
const rooms = new RoomManager();

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (pathname === "/ws" || pathname === "/.proxy/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
    return;
  }
  socket.destroy();
});

wss.on("connection", (ws) => {
  rooms.attach(ws);
});

setInterval(() => rooms.dropIdle(), 15 * 1000).unref?.();

function openBrowser(url) {
  if (process.env.OPEN_BROWSER === "0") return;
  if (process.env.OPEN_BROWSER !== "1" && process.platform !== "win32") return;
  if (process.platform === "win32") {
    spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  }
}

server.listen(PORT, HOST, () => {
  const publicUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
  const localUrl = `http://localhost:${PORT}`;
  console.log("");
  console.log("  TACTICAL MAP");
  console.log(`  HTTP      ${publicUrl}`);
  console.log(`  WebSocket ${publicUrl.replace(/^http/, "ws")}/ws`);
  console.log(`  Maps dir  ${MAPS_DIR}`);
  console.log(`  Client ID ${process.env.DISCORD_CLIENT_ID || "(not set — local fallback only)"}`);
  console.log("");
  console.log("  Open Chrome:");
  console.log(`  ${localUrl}`);
  console.log("  Do not close this window.");
  console.log("");
  if (!process.env.PUBLIC_URL) openBrowser(localUrl);
});
