import { MSG, TOOL, uid } from "./protocol.js";

function simplify(points, minDist) {
  if (points.length < 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const p = points[i];
    if (Math.hypot(p.x - prev.x, p.y - prev.y) >= minDist) out.push(p);
  }
  const last = points[points.length - 1];
  const tail = out[out.length - 1];
  if (tail.x !== last.x || tail.y !== last.y) out.push(last);
  return out;
}

export function createTools({ mapView, getState, send, onTextRequest, getPinType, getTool, setSelected }) {
  let dragging = false;
  let panning = false;
  let mode = null;
  let startMap = null;
  let startScreen = null;
  let draft = null;
  let sent = false;
  let lastSend = 0;
  let lastCursor = 0;
  let lastCursorPos = { x: -1, y: -1 };
  let pointerId = null;

  function meColor() {
    return getState().me?.color || "#e74c3c";
  }

  function meOwner() {
    const me = getState().me;
    return { ownerId: me?.id, ownerName: me?.username };
  }

  function style() {
    return { color: meColor(), width: 0.0035 };
  }

  function flushScene(preview) {
    const state = getState();
    mapView.setScene({
      objectList: [...state.objects.values()],
      selected: state.selectedId,
      previewObj: preview || draft,
      cursorList: [...state.cursors.values()],
      pingList: state.pings,
      users: state.users,
    });
  }

  function addObject(object, commit = true) {
    send({ type: MSG.OBJECT_ADD, object, commit });
    getState().objects.set(object.id, object);
    flushScene();
  }

  function updateObject(object, commit = false) {
    send({ type: MSG.OBJECT_UPDATE, id: object.id, object, commit });
    getState().objects.set(object.id, object);
    flushScene();
  }

  function removeObject(id) {
    send({ type: MSG.OBJECT_REMOVE, id });
    getState().objects.delete(id);
    if (getState().selectedId === id) setSelected(null);
    flushScene();
  }

  function maybeCursor(n) {
    const t = Date.now();
    if (t - lastCursor < 50) return;
    if (Math.hypot(n.x - lastCursorPos.x, n.y - lastCursorPos.y) < 0.0015) return;
    lastCursor = t;
    lastCursorPos = n;
    send({ type: MSG.CURSOR, x: n.x, y: n.y });
  }

  function beginPen(n) {
    draft = {
      id: uid(),
      type: "pen",
      ...meOwner(),
      createdAt: Date.now(),
      style: style(),
      coordinates: { points: [{ x: n.x, y: n.y }] },
    };
    sent = false;
  }

  function movePen(n) {
    if (!draft) return;
    draft.coordinates.points.push({ x: n.x, y: n.y });
    draft.coordinates.points = simplify(draft.coordinates.points, 0.0018);
    const t = Date.now();
    if (t - lastSend > 40) {
      lastSend = t;
      if (!sent) {
        addObject(draft, false);
        sent = true;
      } else {
        updateObject(draft, false);
      }
    }
    flushScene(draft);
  }

  function endPen() {
    if (!draft) return;
    if (draft.coordinates.points.length < 2) {
      draft = null;
      flushScene();
      return;
    }
    if (!sent) addObject(draft, true);
    else updateObject(draft, true);
    draft = null;
    sent = false;
  }

  function beginArrow(n) {
    draft = {
      id: uid(),
      type: "arrow",
      ...meOwner(),
      createdAt: Date.now(),
      style: style(),
      coordinates: { x1: n.x, y1: n.y, x2: n.x, y2: n.y },
    };
  }

  function moveArrow(n) {
    if (!draft) return;
    draft.coordinates.x2 = n.x;
    draft.coordinates.y2 = n.y;
    flushScene(draft);
  }

  function endArrow() {
    if (!draft) return;
    const c = draft.coordinates;
    if (Math.hypot(c.x2 - c.x1, c.y2 - c.y1) < 0.006) {
      draft = null;
      flushScene();
      return;
    }
    addObject(draft, true);
    draft = null;
  }

  function beginCircle(n) {
    draft = {
      id: uid(),
      type: "circle",
      ...meOwner(),
      createdAt: Date.now(),
      style: style(),
      coordinates: { cx: n.x, cy: n.y, rx: 0.002, ry: 0.002 },
      _origin: { x: n.x, y: n.y },
    };
  }

  function moveCircle(n) {
    if (!draft) return;
    const o = draft._origin;
    draft.coordinates.cx = (o.x + n.x) / 2;
    draft.coordinates.cy = (o.y + n.y) / 2;
    draft.coordinates.rx = Math.abs(n.x - o.x) / 2;
    draft.coordinates.ry = Math.abs(n.y - o.y) / 2;
    flushScene(draft);
  }

  function endCircle() {
    if (!draft) return;
    if (draft.coordinates.rx < 0.004 && draft.coordinates.ry < 0.004) {
      draft = null;
      flushScene();
      return;
    }
    delete draft._origin;
    addObject(draft, true);
    draft = null;
  }

  function placePin(n) {
    const object = {
      id: uid(),
      type: "pin",
      pinType: getPinType(),
      ...meOwner(),
      createdAt: Date.now(),
      style: style(),
      coordinates: { x: n.x, y: n.y },
    };
    addObject(object, true);
  }

  function placePing(n) {
    send({ type: MSG.PING, id: uid(), x: n.x, y: n.y });
  }

  function eraseAt(n) {
    const hit = mapView.hitTest(n.x, n.y, 14);
    if (hit) removeObject(hit.id);
  }

  function onPointerDown(ev) {
    if (ev.button === 2 || ev.button === 1 || mapView.isSpaceDown()) {
      panning = true;
      pointerId = ev.pointerId;
      startScreen = mapView.eventToLocal(ev);
      mapView.stageEl.setPointerCapture?.(ev.pointerId);
      ev.preventDefault();
      return;
    }
    if (ev.button !== 0) return;
    const local = mapView.eventToLocal(ev);
    const n = mapView.toMap(local.x, local.y);
    maybeCursor(n);
    const tool = getTool();
    dragging = true;
    pointerId = ev.pointerId;
    startMap = n;
    startScreen = local;
    mapView.stageEl.setPointerCapture?.(ev.pointerId);

    if (tool === TOOL.SELECT) {
      const hit = mapView.hitTest(n.x, n.y, 12);
      setSelected(hit?.id || null);
      mode = hit ? "move" : "pan";
      if (hit) {
        draft = JSON.parse(JSON.stringify(hit));
        draft._ox = n.x;
        draft._oy = n.y;
      } else {
        panning = true;
      }
      flushScene();
      return;
    }

    if (!mapView.inMap(n) && tool !== TOOL.SELECT) return;

    mode = tool;
    if (tool === TOOL.PEN) beginPen(n);
    else if (tool === TOOL.ARROW) beginArrow(n);
    else if (tool === TOOL.CIRCLE) beginCircle(n);
    else if (tool === TOOL.PIN) {
      placePin(n);
      dragging = false;
    } else if (tool === TOOL.TEXT) {
      dragging = false;
      onTextRequest(n, local);
    } else if (tool === TOOL.ERASER) eraseAt(n);
    else if (tool === TOOL.PING) {
      placePing(n);
      dragging = false;
    }
  }

  function onPointerMove(ev) {
    const local = mapView.eventToLocal(ev);
    const n = mapView.toMap(local.x, local.y);
    maybeCursor(n);

    if (panning && startScreen) {
      mapView.pan(local.x - startScreen.x, local.y - startScreen.y);
      startScreen = local;
      return;
    }
    if (!dragging) return;

    if (mode === "move" && draft) {
      const dx = n.x - draft._ox;
      const dy = n.y - draft._oy;
      draft._ox = n.x;
      draft._oy = n.y;
      const obj = getState().objects.get(draft.id);
      if (!obj) return;
      if (obj.type === "pin" || obj.type === "text") {
        obj.coordinates.x += dx;
        obj.coordinates.y += dy;
      } else if (obj.type === "circle") {
        obj.coordinates.cx += dx;
        obj.coordinates.cy += dy;
      } else if (obj.type === "arrow") {
        obj.coordinates.x1 += dx;
        obj.coordinates.y1 += dy;
        obj.coordinates.x2 += dx;
        obj.coordinates.y2 += dy;
      } else if (obj.type === "pen") {
        obj.coordinates.points = obj.coordinates.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      }
      const t = Date.now();
      if (t - lastSend > 40) {
        lastSend = t;
        updateObject(obj, false);
      } else {
        flushScene();
      }
      return;
    }

    if (mode === TOOL.PEN) movePen(n);
    else if (mode === TOOL.ARROW) moveArrow(n);
    else if (mode === TOOL.CIRCLE) moveCircle(n);
    else if (mode === TOOL.ERASER) eraseAt(n);
  }

  function onPointerUp() {
    if (mode === "move" && getState().selectedId) {
      const obj = getState().objects.get(getState().selectedId);
      if (obj) updateObject(obj, true);
    }
    if (mode === TOOL.PEN) endPen();
    else if (mode === TOOL.ARROW) endArrow();
    else if (mode === TOOL.CIRCLE) endCircle();
    dragging = false;
    panning = false;
    mode = null;
    draft = null;
    startMap = null;
    startScreen = null;
    pointerId = null;
  }

  function onWheel(ev) {
    ev.preventDefault();
    const local = mapView.eventToLocal(ev);
    const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    mapView.zoomAt(local.x, local.y, factor);
    onZoom?.();
  }

  let onZoom = null;

  mapView.stageEl.addEventListener("pointerdown", onPointerDown);
  mapView.stageEl.addEventListener("pointermove", onPointerMove);
  mapView.stageEl.addEventListener("pointerup", onPointerUp);
  mapView.stageEl.addEventListener("pointercancel", onPointerUp);
  mapView.stageEl.addEventListener("wheel", onWheel, { passive: false });
  mapView.stageEl.addEventListener("contextmenu", (e) => e.preventDefault());

  return {
    flushScene,
    addObject,
    removeObject,
    setOnZoom(fn) {
      onZoom = fn;
    },
    placeText(n, text) {
      const object = {
        id: uid(),
        type: "text",
        text,
        ...meOwner(),
        createdAt: Date.now(),
        style: style(),
        coordinates: { x: n.x, y: n.y },
      };
      addObject(object, true);
    },
  };
}
