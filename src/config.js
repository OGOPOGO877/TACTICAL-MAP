import fs from "fs";
import path from "path";

export const MAPS = [
  { id: "customs", name: "CUSTOMS", file: "customs.png" },
  { id: "woods", name: "WOODS", file: "woods.png" },
  { id: "shoreline", name: "SHORELINE", file: "shoreline.png" },
  { id: "reserve", name: "RESERVE", file: "reserve.png" },
  { id: "interchange", name: "INTERCHANGE", file: "interchange.png" },
  { id: "streets", name: "STREETS", file: "streets.png" },
  { id: "lighthouse", name: "LIGHTHOUSE", file: "lighthouse.png" },
  { id: "ground-zero", name: "GROUND ZERO", file: "ground-zero.png" },
  { id: "factory", name: "FACTORY", file: "factory.png" },
  { id: "lab", name: "THE LAB", file: "lab.png" },
];

export const MAP_IDS = new Set(MAPS.map((m) => m.id));
export const DEFAULT_MAP = "customs";

export const PIN_TYPES = [
  "ENEMY",
  "TEAM",
  "DANGER",
  "LOOT",
  "EXIT",
  "MEET",
  "SNIPER",
];

export const USER_COLORS = [
  "#e74c3c",
  "#3498db",
  "#2ecc71",
  "#f1c40f",
  "#9b59b6",
  "#e67e22",
  "#1abc9c",
  "#fd79a8",
  "#74b9ff",
  "#a3e635",
];

export const OBJECT_TYPES = new Set(["pen", "arrow", "circle", "pin", "text"]);

export const LIMITS = {
  maxObjectsPerMap: 2500,
  maxPenPoints: 800,
  maxTextLength: 200,
  maxUsernameLength: 32,
  maxUsersPerRoom: 32,
  maxPayloadBytes: 512 * 1024,
  emptyRoomTtlMs: 30 * 60 * 1000,
  idleTimeoutMs: 5 * 60 * 1000,
};

export function mapsWithAvailability(mapsDir) {
  return MAPS.map((m) => ({
    ...m,
    available: fs.existsSync(path.join(mapsDir, m.file)),
  }));
}

export function publicConfig(mapsDir, extra = {}) {
  return {
    clientId: process.env.DISCORD_CLIENT_ID || "",
    maps: mapsWithAvailability(mapsDir),
    pinTypes: PIN_TYPES,
    defaultMap: DEFAULT_MAP,
    pingDurationMs: 3000,
    ...extra,
  };
}
