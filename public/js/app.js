import { loadConfig, setLocalUsername, PEN_COLORS, PEN_WIDTHS } from "./config.js";
import { initDiscord, updatePresence } from "./discord.js";
import { createSocket } from "./websocket.js";
import { createMapView } from "./canvas.js";
import { createTools } from "./tools.js";
import { bindUi } from "./ui.js";
import { MSG, TOOL } from "./protocol.js";
import {
  createState,
  applyRoomState,
  upsertUser,
  removeUser,
  upsertObject,
  removeObject,
  clearObjects,
  addPing,
  pruneEphemeral,
  setCursor,
} from "./state.js";

["gesturestart", "gesturechange", "gestureend"].forEach((type) => {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
});

const state = createState();
const ui = bindUi();
let currentTool = TOOL.SELECT;
let currentPin = "ENEMY";
let penColor = sessionStorage.getItem("tactical-map-pen-color") || "#e74c3c";
let penWidthIndex = Number(sessionStorage.getItem("tactical-map-pen-width") || "3");
if (!Number.isFinite(penWidthIndex) || penWidthIndex < 1 || penWidthIndex > PEN_WIDTHS.length) {
  penWidthIndex = 3;
}
let socket = null;
let tools = null;
let mapView = null;
let appConfig = null;

function mapFile(id) {
  return (appConfig?.maps || []).find((m) => m.id === id)?.file || `${id}.png`;
}

function mapName(id) {
  return (appConfig?.maps || []).find((m) => m.id === id)?.name || id;
}

function refreshScene() {
  pruneEphemeral(state);
  tools?.flushScene();
  ui.renderUsers(state.users, state.me?.id);
}

function onServerEvent(msg) {
  switch (msg.type) {
    case MSG.WELCOME:
      state.me = msg.user;
      state.roomId = msg.roomId;
      break;
    case MSG.ROOM_STATE:
      applyRoomState(state, msg);
      ui.setCurrentMap(state.currentMap);
      mapView.setMapImage(mapFile(state.currentMap));
      ui.hideBoot();
      updatePresence(state.session, mapName(state.currentMap), state.users.size);
      refreshScene();
      break;
    case MSG.USER_JOINED:
      upsertUser(state, msg.user);
      refreshScene();
      updatePresence(state.session, mapName(state.currentMap), state.users.size);
      break;
    case MSG.USER_LEFT:
      removeUser(state, msg.userId);
      refreshScene();
      updatePresence(state.session, mapName(state.currentMap), state.users.size);
      break;
    case MSG.MAP_CHANGED:
      state.currentMap = msg.mapId;
      state.objects = new Map((msg.objects || []).map((o) => [o.id, o]));
      state.selectedId = null;
      ui.setCurrentMap(msg.mapId);
      mapView.setMapImage(mapFile(msg.mapId));
      refreshScene();
      updatePresence(state.session, mapName(msg.mapId), state.users.size);
      break;
    case MSG.OBJECT_ADDED:
      upsertObject(state, msg.object);
      refreshScene();
      break;
    case MSG.OBJECT_UPDATED:
      upsertObject(state, msg.object);
      refreshScene();
      break;
    case MSG.OBJECT_REMOVED:
      removeObject(state, msg.id);
      refreshScene();
      break;
    case MSG.ROOM_CLEARED:
      clearObjects(state);
      refreshScene();
      break;
    case MSG.PING_BROADCAST:
      addPing(state, msg, appConfig?.pingDurationMs || 3000);
      refreshScene();
      break;
    case MSG.CURSOR_BROADCAST:
      setCursor(state, msg);
      refreshScene();
      break;
    case MSG.ERROR:
      console.warn("server:", msg.message);
      break;
    default:
      break;
  }
}

function setTool(tool) {
  currentTool = tool;
  ui.setTool(tool);
  mapView.stageEl.dataset.tool = tool;
}

function send(payload) {
  socket?.send(payload);
}

async function main() {
  ui.setBoot("LOADING CONFIG...");
  appConfig = await loadConfig();
  state.maps = appConfig.maps || [];
  ui.setMaps(state.maps, appConfig.defaultMap || "customs");

  ui.setBoot("CONNECTING TO DISCORD...");
  const session = await initDiscord(appConfig.clientId);
  state.session = session;
  state.me = { ...session.user, color: "#c9a227" };
  state.roomId = session.roomId;
  ui.showLocalDev(session);

  mapView = createMapView(document.getElementById("stage"), document.getElementById("map-overlay"));
  mapView.setMapImage(mapFile(state.currentMap));
  ui.setZoom(mapView.zoomLabel());

  tools = createTools({
    mapView,
    getState: () => state,
    send,
    getTool: () => currentTool,
    getPinType: () => currentPin,
    getStyle: () => ({ color: penColor, width: PEN_WIDTHS[penWidthIndex - 1] }),
    setSelected(id) {
      state.selectedId = id;
      refreshScene();
    },
    async onTextRequest(n, local) {
      const text = await ui.requestText(local, mapView.stageEl.getBoundingClientRect());
      if (text) tools.placeText(n, text);
    },
  });
  tools.setOnZoom(() => ui.setZoom(mapView.zoomLabel()));

  ui.setBoot("CONNECTING WEBSOCKET...");
  socket = createSocket({
    getJoinPayload: () => ({
      roomId: state.session.roomId,
      user: {
        id: state.session.user.id,
        username: state.session.user.username,
        avatar: state.session.user.avatar || "",
      },
    }),
    onEvent: onServerEvent,
    onStatus(status) {
      state.status = status;
      ui.setStatus(status);
      if (status === "CONNECTED" || status === "RECONNECTING") ui.hideBoot();
    },
  });

  ui.els.mapSelect.addEventListener("change", () => {
    send({ type: MSG.MAP_CHANGE, mapId: ui.els.mapSelect.value });
  });

  for (const btn of ui.els.toolButtons) {
    btn.addEventListener("click", async () => {
      const tool = btn.dataset.tool;
      if (tool === "undo") {
        send({ type: MSG.UNDO });
        return;
      }
      if (tool === "redo") {
        send({ type: MSG.REDO });
        return;
      }
      if (tool === "clear") {
        if (await ui.confirmClear()) send({ type: MSG.CLEAR });
        return;
      }
      setTool(tool);
    });
  }

  for (const btn of ui.els.pinButtons) {
    btn.addEventListener("click", () => {
      currentPin = btn.dataset.pin;
      ui.setPinType(currentPin);
      setTool(TOOL.PIN);
    });
  }
  ui.setPinType(currentPin);
  ui.bindPenStyle({
    colors: PEN_COLORS,
    color: penColor,
    widthIndex: penWidthIndex,
    onColor(hex) {
      penColor = hex;
      sessionStorage.setItem("tactical-map-pen-color", hex);
      ui.setPenColor(hex);
    },
    onWidth(index) {
      penWidthIndex = index;
      sessionStorage.setItem("tactical-map-pen-width", String(index));
    },
  });
  setTool(TOOL.SELECT);

  document.getElementById("btn-fit").addEventListener("click", () => {
    ui.setZoom(mapView.fitToScreen());
  });
  document.getElementById("btn-reset").addEventListener("click", () => {
    ui.setZoom(mapView.resetView());
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      mapView.setSpaceDown(true);
      e.preventDefault();
    }
    if (e.target.matches("input, textarea")) return;
    const key = e.key.toLowerCase();
    if (key === "v") setTool(TOOL.SELECT);
    if (key === "p") setTool(TOOL.PEN);
    if (key === "a") setTool(TOOL.ARROW);
    if (key === "c") setTool(TOOL.CIRCLE);
    if (key === "n") setTool(TOOL.PIN);
    if (key === "t") setTool(TOOL.TEXT);
    if (key === "e") setTool(TOOL.ERASER);
    if (key === "g") setTool(TOOL.PING);
    if (key === "f") ui.setZoom(mapView.fitToScreen());
    if (key === "r" && !e.ctrlKey && !e.metaKey) ui.setZoom(mapView.resetView());
    if ((e.ctrlKey || e.metaKey) && key === "z") {
      e.preventDefault();
      send({ type: e.shiftKey ? MSG.REDO : MSG.UNDO });
    }
    if ((e.ctrlKey || e.metaKey) && key === "y") {
      e.preventDefault();
      send({ type: MSG.REDO });
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (state.selectedId) {
        send({ type: MSG.OBJECT_REMOVE, id: state.selectedId });
      }
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") mapView.setSpaceDown(false);
  });

  ui.els.localName?.addEventListener("change", () => {
    const name = setLocalUsername(ui.els.localName.value);
    state.session.user.username = name;
    socket.reconnect();
  });
  ui.els.localRoom?.addEventListener("change", () => {
    const room = ui.els.localRoom.value.trim().slice(0, 128);
    if (!room) return;
    sessionStorage.setItem("tactical-map-room", room);
    const url = new URL(location.href);
    url.searchParams.set("room", room);
    history.replaceState(null, "", url);
    state.session.roomId = room;
    ui.showLocalDev(state.session);
    socket.reconnect();
  });
  document.getElementById("copy-url")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(ui.els.localUrl.value);
    } catch {
      ui.els.localUrl.select();
    }
  });

  setInterval(refreshScene, 80);
}

main().catch((err) => {
  console.error(err);
  ui.setBoot(`FAILED: ${err.message || err}`);
});
