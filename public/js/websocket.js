import { MSG } from "./protocol.js";
import { wsUrl } from "./config.js";

const BACKOFF = [500, 1000, 2000, 4000, 8000, 12000];

export function createSocket({ getJoinPayload, onEvent, onStatus }) {
  let ws = null;
  let closedByUser = false;
  let attempt = 0;
  let heartbeatTimer = null;
  let lastAck = 0;
  let reconnectTimer = null;
  let connecting = false;

  function setStatus(status) {
    onStatus?.(status);
  }

  function clearHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function startHeartbeat() {
    clearHeartbeat();
    lastAck = Date.now();
    heartbeatTimer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastAck > 90000) {
        try {
          ws.close(4002, "heartbeat timeout");
        } catch {
          /* ignore */
        }
        return;
      }
      send({ type: MSG.HEARTBEAT, ts: Date.now() });
    }, 15000);
  }

  function send(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(obj));
      return true;
    } catch {
      return false;
    }
  }

  function connect() {
    if (closedByUser) return;
    if (connecting) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    clearTimeout(reconnectTimer);
    connecting = true;
    setStatus(attempt === 0 && !ws ? "CONNECTING" : "RECONNECTING");

    const socket = new WebSocket(wsUrl());
    ws = socket;

    socket.addEventListener("open", () => {
      if (ws !== socket) return;
      connecting = false;
      attempt = 0;
      setStatus("CONNECTED");
      startHeartbeat();
      const join = getJoinPayload();
      send({ type: MSG.JOIN, ...join });
    });

    socket.addEventListener("message", (ev) => {
      if (ws !== socket) return;
      lastAck = Date.now();
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      if (msg.type === MSG.HEARTBEAT_ACK) return;
      onEvent?.(msg);
    });

    socket.addEventListener("close", () => {
      if (ws !== socket) return;
      connecting = false;
      clearHeartbeat();
      ws = null;
      if (closedByUser) {
        setStatus("DISCONNECTED");
        return;
      }
      setStatus("RECONNECTING");
      const wait = BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
      attempt += 1;
      reconnectTimer = setTimeout(connect, wait);
    });

    socket.addEventListener("error", () => {
      /* close handler will reconnect */
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (!ws || ws.readyState === WebSocket.CLOSED) connect();
    }
  });

  connect();

  return {
    send,
    reconnect() {
      closedByUser = false;
      attempt = 0;
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      connect();
    },
    close() {
      closedByUser = true;
      clearHeartbeat();
      clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    },
    getStatus() {
      if (closedByUser) return "DISCONNECTED";
      if (ws?.readyState === WebSocket.OPEN) return "CONNECTED";
      return "RECONNECTING";
    },
  };
}
