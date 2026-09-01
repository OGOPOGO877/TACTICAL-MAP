export const FALLBACK_MAPS = [
  { id: "customs", name: "CUSTOMS", file: "customs.png", available: false },
  { id: "woods", name: "WOODS", file: "woods.png", available: false },
  { id: "shoreline", name: "SHORELINE", file: "shoreline.png", available: false },
  { id: "reserve", name: "RESERVE", file: "reserve.png", available: false },
  { id: "interchange", name: "INTERCHANGE", file: "interchange.png", available: false },
  { id: "streets", name: "STREETS", file: "streets.png", available: false },
  { id: "lighthouse", name: "LIGHTHOUSE", file: "lighthouse.png", available: false },
  { id: "ground-zero", name: "GROUND ZERO", file: "ground-zero.png", available: false },
  { id: "factory", name: "FACTORY", file: "factory.png", available: false },
  { id: "lab", name: "THE LAB", file: "lab.png", available: false },
];

export const PIN_META = {
  ENEMY: { label: "ENEMY", color: "#e74c3c", glyph: "E" },
  TEAM: { label: "TEAM", color: "#3498db", glyph: "T" },
  DANGER: { label: "DANGER", color: "#e67e22", glyph: "!" },
  LOOT: { label: "LOOT", color: "#f1c40f", glyph: "L" },
  EXIT: { label: "EXIT", color: "#2ecc71", glyph: "X" },
  MEET: { label: "MEET", color: "#9b59b6", glyph: "M" },
  SNIPER: { label: "SNIPER", color: "#ecf0f1", glyph: "S" },
};

export const PING_MS = 3000;

export const PEN_COLORS = [
  "#e74c3c",
  "#e67e22",
  "#f1c40f",
  "#2ecc71",
  "#3498db",
  "#9b59b6",
  "#fd79a8",
  "#ecf0f1",
  "#111111",
  "#c9a227",
];

export const PEN_WIDTHS = [0.0014, 0.0022, 0.0035, 0.005, 0.007, 0.01, 0.014, 0.02];

export function isDiscordHost() {
  const host = location.hostname;
  return host.endsWith("discordsays.com") || host.endsWith("discord.com") || host.endsWith("discordapp.com");
}

export function isDiscordEmbed() {
  const q = new URLSearchParams(location.search);
  return isDiscordHost() || q.has("frame_id") || q.has("instance_id");
}

export function apiUrl(pathname) {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (isDiscordHost()) return `/.proxy${path}`;
  return path;
}

export function wsUrl() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  if (isDiscordHost()) return `${proto}://${location.host}/.proxy/ws`;
  return `${proto}://${location.host}/ws`;
}

export function avatarUrl(user) {
  if (!user) return "";
  if (user.avatarUrl) return user.avatarUrl;
  if (user.avatar && /^\d+$/.test(user.id) && /^[a-zA-Z0-9_]+$/.test(user.avatar)) {
    return apiUrl(`/api/avatar/${user.id}/${user.avatar}`);
  }
  return "";
}

export async function loadConfig() {
  const candidates = isDiscordHost()
    ? [apiUrl("/api/config"), "/api/config"]
    : ["/api/config"];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return await res.json();
    } catch {
      /* try next */
    }
  }
  return {
    clientId: "",
    maps: FALLBACK_MAPS,
    pinTypes: Object.keys(PIN_META),
    defaultMap: "customs",
    pingDurationMs: PING_MS,
  };
}

export function localUserId() {
  const key = "tactical-map-tab-id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = `local-${crypto.randomUUID?.() || Math.random().toString(36).slice(2, 12)}`;
    sessionStorage.setItem(key, id);
  }
  return id;
}

export function localUsername() {
  const key = "tactical-map-username";
  let name = sessionStorage.getItem(key);
  if (!name) {
    name = `Operator-${localUserId().replace(/[^a-zA-Z0-9]/g, "").slice(-4)}`;
    sessionStorage.setItem(key, name);
  }
  return name;
}

export function setLocalUsername(name) {
  const cleaned = String(name || "").trim().slice(0, 32);
  if (cleaned) sessionStorage.setItem("tactical-map-username", cleaned);
  return cleaned;
}

export function localRoomId() {
  const q = new URLSearchParams(location.search).get("room");
  if (q) {
    sessionStorage.setItem("tactical-map-room", q);
    return q.slice(0, 128);
  }
  const stored = sessionStorage.getItem("tactical-map-room");
  if (stored) return stored;
  const generated = `local-${Math.random().toString(36).slice(2, 10)}`;
  sessionStorage.setItem("tactical-map-room", generated);
  return generated;
}
