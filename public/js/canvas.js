import { PIN_META, assetUrl } from "./config.js";

const VIRTUAL_W = 1920;
const VIRTUAL_H = 1080;

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(px, py, x1, y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(px, py, x1 + t * dx, y1 + t * dy);
}

function distToPoly(px, py, points) {
  if (!points?.length) return Infinity;
  if (points.length === 1) return dist(px, py, points[0].x, points[0].y);
  let min = Infinity;
  for (let i = 1; i < points.length; i++) {
    min = Math.min(min, distToSeg(px, py, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y));
  }
  return min;
}

export function createMapView(stageEl, overlayEl) {
  const mapCanvas = document.createElement("canvas");
  const fxCanvas = document.createElement("canvas");
  mapCanvas.className = "layer layer-map";
  fxCanvas.className = "layer layer-fx";
  stageEl.appendChild(mapCanvas);
  stageEl.appendChild(fxCanvas);

  const mapCtx = mapCanvas.getContext("2d");
  const fxCtx = fxCanvas.getContext("2d");

  const view = {
    scale: 1,
    fitScale: 1,
    zoom: 1,
    ox: 0,
    oy: 0,
    imgW: VIRTUAL_W,
    imgH: VIRTUAL_H,
    cssW: 1,
    cssH: 1,
  };

  let image = null;
  let imageOk = false;
  let currentFile = "";
  let objects = [];
  let selectedId = null;
  let preview = null;
  let cursors = [];
  let pings = [];
  let usersById = new Map();
  let hoverName = "";
  let dirtyMap = true;
  let dirtyFx = true;
  let spaceDown = false;

  function cssSize() {
    const rect = stageEl.getBoundingClientRect();
    return { w: Math.max(1, rect.width), h: Math.max(1, rect.height) };
  }

  function resize() {
    const { w, h } = cssSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [mapCanvas, fxCanvas]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      const ctx = c.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const cx = view.cssW / 2;
    const cy = view.cssH / 2;
    const center = toMap(cx, cy);
    view.cssW = w;
    view.cssH = h;
    view.fitScale = Math.min(w / view.imgW, h / view.imgH);
    view.scale = view.fitScale * view.zoom;
    if (Number.isFinite(center.x)) {
      view.ox = w / 2 - center.x * view.imgW * view.scale;
      view.oy = h / 2 - center.y * view.imgH * view.scale;
    }
    dirtyMap = true;
    dirtyFx = true;
  }

  function toScreen(nx, ny) {
    return {
      x: view.ox + nx * view.imgW * view.scale,
      y: view.oy + ny * view.imgH * view.scale,
    };
  }

  function toMap(sx, sy) {
    const denX = view.imgW * view.scale;
    const denY = view.imgH * view.scale;
    return {
      x: denX === 0 ? 0 : (sx - view.ox) / denX,
      y: denY === 0 ? 0 : (sy - view.oy) / denY,
    };
  }

  function eventToLocal(ev) {
    const rect = stageEl.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function strokeWidth(obj) {
    const n = obj?.style?.width || 0.0035;
    return Math.max(1.5, n * Math.min(view.imgW, view.imgH) * view.scale);
  }

  function fitToScreen() {
    const { w, h } = cssSize();
    view.cssW = w;
    view.cssH = h;
    view.fitScale = Math.min(w / view.imgW, h / view.imgH);
    view.zoom = 1;
    view.scale = view.fitScale;
    view.ox = (w - view.imgW * view.scale) / 2;
    view.oy = (h - view.imgH * view.scale) / 2;
    dirtyMap = true;
    dirtyFx = true;
    return zoomLabel();
  }

  function resetView() {
    const { w, h } = cssSize();
    view.fitScale = Math.min(w / view.imgW, h / view.imgH);
    view.scale = 1;
    view.zoom = view.fitScale === 0 ? 1 : view.scale / view.fitScale;
    view.ox = (w - view.imgW * view.scale) / 2;
    view.oy = (h - view.imgH * view.scale) / 2;
    dirtyMap = true;
    dirtyFx = true;
    return zoomLabel();
  }

  function zoomAt(sx, sy, factor) {
    const before = toMap(sx, sy);
    view.zoom = Math.min(16, Math.max(0.25, view.zoom * factor));
    view.scale = view.fitScale * view.zoom;
    view.ox = sx - before.x * view.imgW * view.scale;
    view.oy = sy - before.y * view.imgH * view.scale;
    dirtyMap = true;
    dirtyFx = true;
    return zoomLabel();
  }

  function pan(dx, dy) {
    view.ox += dx;
    view.oy += dy;
    dirtyMap = true;
    dirtyFx = true;
  }

  function zoomLabel() {
    return `${Math.round(view.zoom * 100)}%`;
  }

  function setMapImage(file) {
    if (file === currentFile && image) return;
    currentFile = file;
    imageOk = false;
    image = new Image();
    image.onload = () => {
      if (currentFile !== file) return;
      imageOk = true;
      view.imgW = image.naturalWidth || VIRTUAL_W;
      view.imgH = image.naturalHeight || VIRTUAL_H;
      fitToScreen();
    };
    image.onerror = () => {
      if (currentFile !== file) return;
      imageOk = false;
      view.imgW = VIRTUAL_W;
      view.imgH = VIRTUAL_H;
      fitToScreen();
    };
    image.src = assetUrl(`/maps/${encodeURIComponent(file)}`);
  }

  function setScene({ objectList, selected, previewObj, cursorList, pingList, users }) {
    objects = objectList || [];
    selectedId = selected || null;
    preview = previewObj || null;
    cursors = cursorList || [];
    pings = pingList || [];
    usersById = users || usersById;
    dirtyMap = true;
    dirtyFx = true;
  }

  function typeOrder(type) {
    return { pen: 1, arrow: 2, circle: 3, pin: 4, text: 5 }[type] || 9;
  }

  function sortedObjects() {
    return [...objects].sort((a, b) => {
      const d = typeOrder(a.type) - typeOrder(b.type);
      if (d !== 0) return d;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  function drawMapBackground(ctx, w, h) {
    ctx.fillStyle = "#0a0b0d";
    ctx.fillRect(0, 0, w, h);

    const x = view.ox;
    const y = view.oy;
    const mw = view.imgW * view.scale;
    const mh = view.imgH * view.scale;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, mw, mh);
    ctx.clip();

    if (imageOk && image) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, x, y, mw, mh);
    } else {
      ctx.fillStyle = "#16181c";
      ctx.fillRect(x, y, mw, mh);
      ctx.strokeStyle = "#3a372f";
      ctx.lineWidth = 1;
      const step = 48 * view.zoom;
      for (let gx = x; gx < x + mw; gx += step) {
        ctx.beginPath();
        ctx.moveTo(gx, y);
        ctx.lineTo(gx, y + mh);
        ctx.stroke();
      }
      for (let gy = y; gy < y + mh; gy += step) {
        ctx.beginPath();
        ctx.moveTo(x, gy);
        ctx.lineTo(x + mw, gy);
        ctx.stroke();
      }
      ctx.fillStyle = "#c9a227";
      ctx.font = `700 ${Math.max(16, Math.min(28, mw * 0.04))}px Segoe UI, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("MAP IMAGE NOT FOUND", x + mw / 2, y + mh / 2 - 12);
      ctx.fillStyle = "#8a8373";
      ctx.font = `500 ${Math.max(11, Math.min(16, mw * 0.02))}px Segoe UI, sans-serif`;
      ctx.fillText("Place PNG in public/maps and reload", x + mw / 2, y + mh / 2 + 16);
    }
    ctx.restore();

    ctx.strokeStyle = "#c9a22755";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, mw - 1, mh - 1);
  }

  function drawPen(ctx, obj, highlight) {
    const pts = obj.coordinates?.points || [];
    if (pts.length < 1) return;
    ctx.beginPath();
    const first = toScreen(pts[0].x, pts[0].y);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < pts.length; i++) {
      const p = toScreen(pts[i].x, pts[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = obj.style?.color || "#e74c3c";
    ctx.lineWidth = strokeWidth(obj) + (highlight ? 2 : 0);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }

  function drawArrow(ctx, obj, highlight) {
    const c = obj.coordinates || {};
    const a = toScreen(c.x1, c.y1);
    const b = toScreen(c.x2, c.y2);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const len = dist(a.x, a.y, b.x, b.y);
    const head = Math.min(18, Math.max(8, len * 0.18));
    ctx.strokeStyle = obj.style?.color || "#e74c3c";
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = strokeWidth(obj) + (highlight ? 2 : 0);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45));
    ctx.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fill();
  }

  function drawCircle(ctx, obj, highlight) {
    const c = obj.coordinates || {};
    const center = toScreen(c.cx, c.cy);
    const rx = Math.abs(c.rx) * view.imgW * view.scale;
    const ry = Math.abs(c.ry) * view.imgH * view.scale;
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
    ctx.strokeStyle = obj.style?.color || "#e74c3c";
    ctx.lineWidth = strokeWidth(obj) + (highlight ? 2 : 0);
    ctx.stroke();
    ctx.fillStyle = `${ctx.strokeStyle}22`;
    ctx.fill();
  }

  function drawPin(ctx, obj, highlight) {
    const c = obj.coordinates || {};
    const p = toScreen(c.x, c.y);
    const meta = PIN_META[obj.pinType] || PIN_META.TEAM;
    const r = Math.max(8, 11 * Math.min(1.6, view.zoom));
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-r * 1.15, -r * 1.1, -r * 1.05, -r * 2.2, 0, -r * 2.35);
    ctx.bezierCurveTo(r * 1.05, -r * 2.2, r * 1.15, -r * 1.1, 0, 0);
    ctx.closePath();
    ctx.fillStyle = meta.color;
    ctx.strokeStyle = highlight ? "#fff" : "#0b0c0e";
    ctx.lineWidth = highlight ? 2.5 : 1.25;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -r * 1.35, r * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = "#111";
    ctx.fill();
    ctx.fillStyle = "#f4f0e6";
    ctx.font = `700 ${Math.max(8, r * 0.85)}px Segoe UI, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(meta.glyph, 0, -r * 1.32);
    ctx.restore();

    const owner = obj.ownerName || usersById.get(obj.ownerId)?.username || "";
    if (owner) {
      ctx.font = "600 10px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const label = owner;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(8,9,11,0.78)";
      ctx.fillRect(p.x - tw / 2 - 4, p.y + 4, tw + 8, 14);
      ctx.fillStyle = "#d7d2c4";
      ctx.fillText(label, p.x, p.y + 6);
    }
  }

  function drawText(ctx, obj, highlight) {
    const c = obj.coordinates || {};
    const p = toScreen(c.x, c.y);
    const text = obj.text || "";
    const size = Math.max(12, 14 * Math.min(1.8, view.zoom));
    ctx.font = `700 ${size}px Segoe UI, sans-serif`;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(10,11,13,0.82)";
    ctx.fillRect(p.x - 6, p.y - size, tw + 12, size + 10);
    ctx.strokeStyle = highlight ? "#fff" : obj.style?.color || "#c9a227";
    ctx.lineWidth = highlight ? 2 : 1;
    ctx.strokeRect(p.x - 6, p.y - size, tw + 12, size + 10);
    ctx.fillStyle = obj.style?.color || "#f4f0e6";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, p.x, p.y);
  }

  function drawObject(ctx, obj, highlight) {
    if (obj.type === "pen") drawPen(ctx, obj, highlight);
    else if (obj.type === "arrow") drawArrow(ctx, obj, highlight);
    else if (obj.type === "circle") drawCircle(ctx, obj, highlight);
    else if (obj.type === "pin") drawPin(ctx, obj, highlight);
    else if (obj.type === "text") drawText(ctx, obj, highlight);
  }

  function drawPing(ctx, ping) {
    const p = toScreen(ping.x, ping.y);
    const life = Math.max(0, (ping.expiresAt - Date.now()) / 3000);
    const t = 1 - life;
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const r = 8 + (t + i * 0.18) * 54;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = ping.color || "#f1c40f";
      ctx.globalAlpha = Math.max(0, 0.85 - t - i * 0.2);
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = ping.color || "#f1c40f";
    ctx.fill();
    ctx.font = "700 11px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.fillText(ping.username || "PING", p.x, p.y - 58 * (0.4 + t * 0.3));
    ctx.restore();
  }

  function drawCursor(ctx, cursor) {
    const p = toScreen(cursor.x, cursor.y);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = cursor.color || "#e74c3c";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 16);
    ctx.lineTo(4.5, 12.5);
    ctx.lineTo(9, 20);
    ctx.lineTo(11.5, 18.5);
    ctx.lineTo(7, 11);
    ctx.lineTo(13, 11);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#0b0c0e";
    ctx.lineWidth = 1;
    ctx.stroke();
    const name = cursor.username || "Operator";
    ctx.font = "700 11px Segoe UI, sans-serif";
    const tw = ctx.measureText(name).width;
    ctx.fillStyle = "rgba(8,9,11,0.88)";
    ctx.fillRect(14, 2, tw + 10, 16);
    ctx.fillStyle = cursor.color || "#fff";
    ctx.fillRect(14, 2, 3, 16);
    ctx.fillStyle = "#f4f0e6";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(name, 20, 10);
    ctx.restore();
  }

  function renderMap() {
    const { w, h } = cssSize();
    mapCtx.clearRect(0, 0, w, h);
    drawMapBackground(mapCtx, w, h);
    for (const obj of sortedObjects()) {
      drawObject(mapCtx, obj, obj.id === selectedId);
    }
    if (preview) drawObject(mapCtx, preview, true);
  }

  function renderFx() {
    const { w, h } = cssSize();
    fxCtx.clearRect(0, 0, w, h);
    for (const ping of pings) drawPing(fxCtx, ping);
    for (const cursor of cursors) drawCursor(fxCtx, cursor);
    if (hoverName) {
      fxCtx.font = "600 11px Segoe UI, sans-serif";
      fxCtx.fillStyle = "#8a8373";
      fxCtx.textAlign = "left";
      fxCtx.fillText(hoverName, 10, h - 10);
    }
  }

  function frame() {
    if (dirtyMap) {
      renderMap();
      dirtyMap = false;
    }
    if (dirtyFx || pings.length) {
      renderFx();
      dirtyFx = false;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function hitTest(nx, ny, thresholdPx = 10) {
    const threshX = thresholdPx / (view.imgW * view.scale);
    const threshY = thresholdPx / (view.imgH * view.scale);
    const thresh = Math.max(threshX, threshY);
    const list = [...sortedObjects()].reverse();
    const click = toScreen(nx, ny);
    for (const obj of list) {
      if (obj.type === "pin") {
        const p = toScreen(obj.coordinates.x, obj.coordinates.y);
        const r = Math.max(8, 11 * Math.min(1.6, view.zoom));
        if (click.x >= p.x - r * 1.3 && click.x <= p.x + r * 1.3 && click.y >= p.y - r * 2.6 && click.y <= p.y + 16) {
          return obj;
        }
      } else if (obj.type === "text") {
        const p = toScreen(obj.coordinates.x, obj.coordinates.y);
        if (click.x >= p.x - 8 && click.x <= p.x + 160 && click.y >= p.y - 22 && click.y <= p.y + 12) return obj;
      } else if (obj.type === "circle") {
        const dx = (nx - obj.coordinates.cx) / (obj.coordinates.rx || 0.001);
        const dy = (ny - obj.coordinates.cy) / (obj.coordinates.ry || 0.001);
        const d = Math.hypot(dx, dy);
        if (Math.abs(d - 1) <= 0.18 || d < 1) return obj;
      } else if (obj.type === "arrow") {
        const c = obj.coordinates;
        if (distToSeg(nx, ny, c.x1, c.y1, c.x2, c.y2) <= thresh * 1.4) return obj;
      } else if (obj.type === "pen") {
        if (distToPoly(nx, ny, obj.coordinates.points) <= thresh * 1.3) return obj;
      }
    }
    return null;
  }

  function inMap(n) {
    return n.x >= -0.02 && n.x <= 1.02 && n.y >= -0.02 && n.y <= 1.02;
  }

  window.addEventListener("resize", resize);
  window.visualViewport?.addEventListener("resize", resize);
  window.visualViewport?.addEventListener("scroll", resize);
  resize();
  fitToScreen();

  return {
    view,
    resize,
    toScreen,
    toMap,
    eventToLocal,
    fitToScreen,
    resetView,
    zoomAt,
    pan,
    zoomLabel,
    setMapImage,
    setScene,
    hitTest,
    inMap,
    isSpaceDown: () => spaceDown,
    setSpaceDown(v) {
      spaceDown = v;
    },
    markDirty() {
      dirtyMap = true;
      dirtyFx = true;
    },
    stageEl,
    overlayEl,
  };
}
