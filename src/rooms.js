import {
  DEFAULT_MAP,
  LIMITS,
  MAP_IDS,
  OBJECT_TYPES,
  PIN_TYPES,
  USER_COLORS,
} from "./config.js";
import { MSG } from "./protocol.js";

function now() {
  return Date.now();
}

function sanitizeText(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.min(1.15, Math.max(-0.15, x));
}

function num(n, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function validId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(id);
}

function sanitizeColor(value, fallback) {
  const raw = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.slice(1).toLowerCase()}`;
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const r = raw[1];
    const g = raw[2];
    const b = raw[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

function hashColorIndex(userId) {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return h % USER_COLORS.length;
}

function normalizePoints(points) {
  if (!Array.isArray(points)) return [];
  const out = [];
  for (const p of points.slice(0, LIMITS.maxPenPoints)) {
    if (!p || typeof p !== "object") continue;
    out.push({ x: clamp01(p.x), y: clamp01(p.y) });
  }
  return out;
}

function normalizeObject(raw, owner) {
  if (!raw || typeof raw !== "object") return null;
  if (!validId(raw.id)) return null;
  if (!OBJECT_TYPES.has(raw.type)) return null;

  const base = {
    id: raw.id,
    type: raw.type,
    ownerId: owner.id,
    ownerName: owner.username,
    createdAt: Number(raw.createdAt) || now(),
    style: {
      color: sanitizeColor(raw.style?.color, owner.color),
      width: Math.min(0.03, Math.max(0.0008, num(raw.style?.width, 0.0035))),
    },
  };

  if (raw.type === "pen") {
    const points = normalizePoints(raw.coordinates?.points);
    if (points.length < 1) return null;
    return { ...base, coordinates: { points } };
  }

  if (raw.type === "arrow") {
    return {
      ...base,
      coordinates: {
        x1: clamp01(raw.coordinates?.x1),
        y1: clamp01(raw.coordinates?.y1),
        x2: clamp01(raw.coordinates?.x2),
        y2: clamp01(raw.coordinates?.y2),
      },
    };
  }

  if (raw.type === "circle") {
    return {
      ...base,
      coordinates: {
        cx: clamp01(raw.coordinates?.cx),
        cy: clamp01(raw.coordinates?.cy),
        rx: Math.min(0.75, Math.max(0.001, Math.abs(num(raw.coordinates?.rx, 0.02)))),
        ry: Math.min(0.75, Math.max(0.001, Math.abs(num(raw.coordinates?.ry, 0.02)))),
      },
    };
  }

  if (raw.type === "pin") {
    const pinType = PIN_TYPES.includes(raw.pinType) ? raw.pinType : "TEAM";
    return {
      ...base,
      pinType,
      coordinates: {
        x: clamp01(raw.coordinates?.x),
        y: clamp01(raw.coordinates?.y),
      },
    };
  }

  if (raw.type === "text") {
    const text = sanitizeText(raw.text, LIMITS.maxTextLength);
    if (!text) return null;
    return {
      ...base,
      text,
      coordinates: {
        x: clamp01(raw.coordinates?.x),
        y: clamp01(raw.coordinates?.y),
      },
    };
  }

  return null;
}

function applyUpdate(existing, patch) {
  if (!existing || !patch) return existing;
  const next = {
    ...existing,
    coordinates: { ...existing.coordinates },
    style: { ...existing.style },
  };

  if (patch.style?.width != null) {
    next.style.width = Math.min(0.03, Math.max(0.0008, num(patch.style.width, next.style.width)));
  }
  if (patch.style?.color != null) {
    next.style.color = sanitizeColor(patch.style.color, next.style.color);
  }

  if (existing.type === "pen" && patch.coordinates?.points) {
    next.coordinates.points = normalizePoints(patch.coordinates.points);
  }
  if (existing.type === "arrow" && patch.coordinates) {
    if (patch.coordinates.x1 != null) next.coordinates.x1 = clamp01(patch.coordinates.x1);
    if (patch.coordinates.y1 != null) next.coordinates.y1 = clamp01(patch.coordinates.y1);
    if (patch.coordinates.x2 != null) next.coordinates.x2 = clamp01(patch.coordinates.x2);
    if (patch.coordinates.y2 != null) next.coordinates.y2 = clamp01(patch.coordinates.y2);
  }
  if (existing.type === "circle" && patch.coordinates) {
    if (patch.coordinates.cx != null) next.coordinates.cx = clamp01(patch.coordinates.cx);
    if (patch.coordinates.cy != null) next.coordinates.cy = clamp01(patch.coordinates.cy);
    if (patch.coordinates.rx != null) {
      next.coordinates.rx = Math.min(0.75, Math.max(0.001, Math.abs(num(patch.coordinates.rx))));
    }
    if (patch.coordinates.ry != null) {
      next.coordinates.ry = Math.min(0.75, Math.max(0.001, Math.abs(num(patch.coordinates.ry))));
    }
  }
  if ((existing.type === "pin" || existing.type === "text") && patch.coordinates) {
    if (patch.coordinates.x != null) next.coordinates.x = clamp01(patch.coordinates.x);
    if (patch.coordinates.y != null) next.coordinates.y = clamp01(patch.coordinates.y);
  }
  if (existing.type === "text" && patch.text != null) {
    next.text = sanitizeText(patch.text, LIMITS.maxTextLength) || existing.text;
  }
  if (existing.type === "pin" && PIN_TYPES.includes(patch.pinType)) {
    next.pinType = patch.pinType;
  }
  return next;
}

class RateLimiter {
  constructor(ratePerSec, burst) {
    this.rate = ratePerSec;
    this.burst = burst;
    this.tokens = burst;
    this.last = Date.now();
  }

  try(cost = 1) {
    const t = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) * this.rate) / 1000);
    this.last = t;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

class Room {
  constructor(id) {
    this.id = id;
    this.currentMap = DEFAULT_MAP;
    this.maps = new Map();
    this.users = new Map();
    this.colors = new Map();
    this.emptySince = null;
    this.ensureMap(this.currentMap);
  }

  ensureMap(mapId) {
    if (!this.maps.has(mapId)) {
      this.maps.set(mapId, {
        objects: new Map(),
        undo: new Map(),
        redo: new Map(),
        draftBefore: new Map(),
      });
    }
    return this.maps.get(mapId);
  }

  current() {
    return this.ensureMap(this.currentMap);
  }

  assignColor(userId) {
    if (this.colors.has(userId)) return this.colors.get(userId);
    const used = new Set(this.colors.values());
    let color = USER_COLORS.find((c) => !used.has(c));
    if (!color) color = USER_COLORS[hashColorIndex(userId)];
    this.colors.set(userId, color);
    return color;
  }

  userList() {
    return [...this.users.values()].map((u) => ({
      id: u.id,
      username: u.username,
      avatar: u.avatar,
      color: u.color,
    }));
  }

  objectsArray(mapId = this.currentMap) {
    return [...this.ensureMap(mapId).objects.values()];
  }

  snapshot() {
    return {
      roomId: this.id,
      currentMap: this.currentMap,
      objects: this.objectsArray(),
      users: this.userList(),
    };
  }

  send(ws, payload) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(payload));
    }
  }

  broadcast(payload, exceptWs = null) {
    const data = JSON.stringify(payload);
    for (const user of this.users.values()) {
      if (exceptWs && user.ws === exceptWs) continue;
      if (user.ws.readyState === 1) user.ws.send(data);
    }
  }

  pushUndo(userId, entry) {
    const map = this.current();
    if (!map.undo.has(userId)) map.undo.set(userId, []);
    if (!map.redo.has(userId)) map.redo.set(userId, []);
    map.undo.get(userId).push(entry);
    if (map.undo.get(userId).length > 100) map.undo.get(userId).shift();
    map.redo.set(userId, []);
  }

  addUser(ws, raw) {
    if (this.users.size >= LIMITS.maxUsersPerRoom) {
      this.send(ws, { type: MSG.ERROR, message: "ROOM FULL" });
      return null;
    }

    const id = sanitizeText(raw?.id, 64) || `user-${Math.random().toString(36).slice(2, 10)}`;
    const username =
      sanitizeText(raw?.username, LIMITS.maxUsernameLength) || `Operator-${id.slice(-4)}`;
    const avatar = typeof raw?.avatar === "string" ? raw.avatar.slice(0, 256) : "";
    const color = this.assignColor(id);

    for (const existing of this.users.values()) {
      if (existing.id === id && existing.ws !== ws) {
        try {
          existing.ws.close(4000, "replaced by reconnect");
        } catch {
          /* ignore */
        }
        this.users.delete(existing.ws);
      }
    }

    const user = { id, username, avatar, color, ws, joinedAt: now() };
    this.users.set(ws, user);
    this.emptySince = null;
    return user;
  }

  removeUser(ws) {
    const user = this.users.get(ws);
    if (!user) return null;
    this.users.delete(ws);
    if (this.users.size === 0) this.emptySince = now();
    return user;
  }

  changeMap(mapId, user) {
    if (!MAP_IDS.has(mapId)) return false;
    this.currentMap = mapId;
    this.ensureMap(mapId);
    this.broadcast({
      type: MSG.MAP_CHANGED,
      mapId,
      objects: this.objectsArray(mapId),
      by: user.id,
    });
    return true;
  }

  addObject(raw, user, commit = true) {
    const map = this.current();
    if (map.objects.size >= LIMITS.maxObjectsPerMap) {
      this.send(user.ws, { type: MSG.ERROR, message: "TOO MANY OBJECTS" });
      return null;
    }
    if (map.objects.has(raw?.id)) {
      return this.updateObject(raw.id, raw, user, commit);
    }
    const obj = normalizeObject(raw, user);
    if (!obj) return null;
    map.objects.set(obj.id, obj);
    if (commit) this.pushUndo(user.id, { op: "add", object: structuredClone(obj) });
    else map.draftBefore.set(obj.id, structuredClone(obj));
    this.broadcast({ type: MSG.OBJECT_ADDED, object: obj });
    return obj;
  }

  undoHasObject(map, userId, objectId) {
    const stack = map.undo.get(userId) || [];
    return stack.some(
      (e) =>
        (e.op === "add" && e.object?.id === objectId) ||
        (e.op === "update" && (e.after?.id === objectId || e.before?.id === objectId)),
    );
  }

  updateObject(id, patch, user, commit = false) {
    const map = this.current();
    const existing = map.objects.get(id);
    if (!existing) return null;
    if (!commit && !map.draftBefore.has(id)) {
      map.draftBefore.set(id, structuredClone(existing));
    }
    const next = applyUpdate(existing, patch);
    map.objects.set(id, next);
    if (commit) {
      const original = map.draftBefore.get(id);
      map.draftBefore.delete(id);
      if (!this.undoHasObject(map, user.id, id)) {
        this.pushUndo(user.id, { op: "add", object: structuredClone(next) });
      } else {
        this.pushUndo(user.id, {
          op: "update",
          before: original || structuredClone(existing),
          after: structuredClone(next),
        });
      }
    }
    this.broadcast({ type: MSG.OBJECT_UPDATED, object: next });
    return next;
  }

  removeObject(id, user) {
    const map = this.current();
    const existing = map.objects.get(id);
    if (!existing) return false;
    map.objects.delete(id);
    this.pushUndo(user.id, { op: "remove", object: structuredClone(existing) });
    this.broadcast({ type: MSG.OBJECT_REMOVED, id });
    return true;
  }

  clear(user) {
    const map = this.current();
    map.objects.clear();
    map.undo.clear();
    map.redo.clear();
    map.draftBefore.clear();
    this.broadcast({ type: MSG.ROOM_CLEARED, by: user.id, mapId: this.currentMap });
  }

  undo(user) {
    const map = this.current();
    const stack = map.undo.get(user.id);
    if (!stack || stack.length === 0) return;
    const entry = stack.pop();
    if (!map.redo.has(user.id)) map.redo.set(user.id, []);
    map.redo.get(user.id).push(entry);
    this.applyInverse(map, entry);
  }

  redo(user) {
    const map = this.current();
    const stack = map.redo.get(user.id);
    if (!stack || stack.length === 0) return;
    const entry = stack.pop();
    if (!map.undo.has(user.id)) map.undo.set(user.id, []);
    map.undo.get(user.id).push(entry);
    this.applyForward(map, entry);
  }

  applyInverse(map, entry) {
    if (entry.op === "add") {
      map.objects.delete(entry.object.id);
      this.broadcast({ type: MSG.OBJECT_REMOVED, id: entry.object.id });
    } else if (entry.op === "remove") {
      map.objects.set(entry.object.id, structuredClone(entry.object));
      this.broadcast({ type: MSG.OBJECT_ADDED, object: entry.object });
    } else if (entry.op === "update") {
      map.objects.set(entry.before.id, structuredClone(entry.before));
      this.broadcast({ type: MSG.OBJECT_UPDATED, object: entry.before });
    }
  }

  applyForward(map, entry) {
    if (entry.op === "add") {
      map.objects.set(entry.object.id, structuredClone(entry.object));
      this.broadcast({ type: MSG.OBJECT_ADDED, object: entry.object });
    } else if (entry.op === "remove") {
      map.objects.delete(entry.object.id);
      this.broadcast({ type: MSG.OBJECT_REMOVED, id: entry.object.id });
    } else if (entry.op === "update") {
      map.objects.set(entry.after.id, structuredClone(entry.after));
      this.broadcast({ type: MSG.OBJECT_UPDATED, object: entry.after });
    }
  }
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.meta = new WeakMap();
    setInterval(() => this.gc(), 60 * 1000).unref?.();
  }

  get(roomId) {
    const id = sanitizeText(roomId, 128) || "local-default";
    if (!this.rooms.has(id)) this.rooms.set(id, new Room(id));
    return this.rooms.get(id);
  }

  gc() {
    const t = now();
    for (const [id, room] of this.rooms) {
      if (room.users.size === 0 && room.emptySince && t - room.emptySince > LIMITS.emptyRoomTtlMs) {
        this.rooms.delete(id);
      }
    }
  }

  attach(ws) {
    const limiter = new RateLimiter(40, 80);
    this.meta.set(ws, { room: null, user: null, limiter, lastSeen: now() });

    ws.on("message", (raw) => this.onMessage(ws, raw));
    ws.on("close", () => this.onClose(ws));
    ws.on("error", () => this.onClose(ws));
  }

  onClose(ws) {
    const meta = this.meta.get(ws);
    if (!meta?.room) return;
    const user = meta.room.removeUser(ws);
    if (user) {
      meta.room.broadcast({ type: MSG.USER_LEFT, userId: user.id });
    }
    this.meta.delete(ws);
  }

  onMessage(ws, raw) {
    const meta = this.meta.get(ws);
    if (!meta) return;
    meta.lastSeen = now();

    let msg;
    try {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      if (text.length > 200000) return;
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;

    const cost = msg.type === MSG.CURSOR ? 0.15 : msg.type === MSG.HEARTBEAT ? 0.1 : 1;
    if (!meta.limiter.try(cost)) return;

    if (msg.type === MSG.HEARTBEAT) {
      try {
        ws.send(JSON.stringify({ type: MSG.HEARTBEAT_ACK, ts: now() }));
      } catch {
        /* ignore */
      }
      return;
    }

    if (msg.type === MSG.JOIN) {
      this.handleJoin(ws, meta, msg);
      return;
    }

    if (!meta.room || !meta.user) {
      this.send(ws, { type: MSG.ERROR, message: "JOIN REQUIRED" });
      return;
    }

    const room = meta.room;
    const user = meta.user;

    switch (msg.type) {
      case MSG.MAP_CHANGE:
        room.changeMap(msg.mapId, user);
        break;
      case MSG.OBJECT_ADD:
        room.addObject(msg.object, user, msg.commit !== false);
        break;
      case MSG.OBJECT_UPDATE:
        room.updateObject(msg.id || msg.object?.id, msg.object || msg, user, Boolean(msg.commit));
        break;
      case MSG.OBJECT_REMOVE:
        room.removeObject(msg.id, user);
        break;
      case MSG.UNDO:
        room.undo(user);
        break;
      case MSG.REDO:
        room.redo(user);
        break;
      case MSG.CLEAR:
        room.clear(user);
        break;
      case MSG.PING: {
        const ping = {
          type: MSG.PING_BROADCAST,
          id: validId(msg.id) ? msg.id : `ping-${now()}`,
          x: clamp01(msg.x),
          y: clamp01(msg.y),
          userId: user.id,
          username: user.username,
          color: user.color,
          createdAt: now(),
        };
        room.broadcast(ping);
        break;
      }
      case MSG.CURSOR:
        room.broadcast(
          {
            type: MSG.CURSOR_BROADCAST,
            userId: user.id,
            username: user.username,
            color: user.color,
            x: clamp01(msg.x),
            y: clamp01(msg.y),
          },
          ws,
        );
        break;
      default:
        break;
    }
  }

  handleJoin(ws, meta, msg) {
    const roomId = sanitizeText(msg.roomId, 128);
    if (!roomId) {
      this.send(ws, { type: MSG.ERROR, message: "ROOM ID REQUIRED" });
      return;
    }

    if (meta.room) {
      const prev = meta.room.removeUser(ws);
      if (prev) meta.room.broadcast({ type: MSG.USER_LEFT, userId: prev.id });
    }

    const room = this.get(roomId);
    const user = room.addUser(ws, msg.user);
    if (!user) return;

    meta.room = room;
    meta.user = user;

    this.send(ws, {
      type: MSG.WELCOME,
      user,
      roomId: room.id,
    });
    this.send(ws, { type: MSG.ROOM_STATE, ...room.snapshot() });
    room.broadcast({ type: MSG.USER_JOINED, user: {
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      color: user.color,
    } }, ws);
  }

  send(ws, payload) {
    if (ws.readyState === 1) ws.send(JSON.stringify(payload));
  }

  dropIdle() {
    const t = now();
    for (const room of this.rooms.values()) {
      for (const user of [...room.users.values()]) {
        const meta = this.meta.get(user.ws);
        if (meta && t - meta.lastSeen > LIMITS.idleTimeoutMs) {
          try {
            user.ws.close(4001, "idle timeout");
          } catch {
            /* ignore */
          }
        }
      }
    }
  }
}
