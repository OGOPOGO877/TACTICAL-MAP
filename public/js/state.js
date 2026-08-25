import { PING_MS } from "./config.js";

export function createState() {
  return {
    session: null,
    me: null,
    roomId: "",
    currentMap: "customs",
    objects: new Map(),
    users: new Map(),
    cursors: new Map(),
    pings: [],
    selectedId: null,
    status: "DISCONNECTED",
    maps: [],
  };
}

export function applyRoomState(state, payload) {
  state.currentMap = payload.currentMap || state.currentMap;
  state.objects = new Map((payload.objects || []).map((o) => [o.id, o]));
  state.users = new Map((payload.users || []).map((u) => [u.id, u]));
  state.cursors = new Map();
  state.pings = [];
  state.selectedId = null;
}

export function upsertUser(state, user) {
  if (!user?.id) return;
  state.users.set(user.id, user);
}

export function removeUser(state, userId) {
  state.users.delete(userId);
  state.cursors.delete(userId);
}

export function upsertObject(state, object) {
  if (!object?.id) return;
  state.objects.set(object.id, object);
}

export function removeObject(state, id) {
  state.objects.delete(id);
  if (state.selectedId === id) state.selectedId = null;
}

export function clearObjects(state) {
  state.objects.clear();
  state.selectedId = null;
}

export function addPing(state, ping, durationMs = PING_MS) {
  const item = { ...ping, expiresAt: Date.now() + durationMs };
  state.pings.push(item);
}

export function pruneEphemeral(state) {
  const t = Date.now();
  state.pings = state.pings.filter((p) => p.expiresAt > t);
  for (const [id, cursor] of state.cursors) {
    if (t - (cursor.updatedAt || 0) > 4000) state.cursors.delete(id);
  }
}

export function setCursor(state, payload) {
  if (!payload?.userId) return;
  if (state.me && payload.userId === state.me.id) return;
  state.cursors.set(payload.userId, {
    ...payload,
    updatedAt: Date.now(),
  });
}
