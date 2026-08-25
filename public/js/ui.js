import { PIN_META, avatarUrl } from "./config.js";
import { TOOL } from "./protocol.js";

export function bindUi() {
  const els = {
    boot: document.getElementById("boot"),
    bootText: document.getElementById("boot-text"),
    app: document.getElementById("app"),
    mapSelect: document.getElementById("map-select"),
    status: document.getElementById("conn-status"),
    usersTop: document.getElementById("users-top"),
    usersBar: document.getElementById("users-bar"),
    zoomLabel: document.getElementById("zoom-label"),
    roomLabel: document.getElementById("room-label"),
    localDev: document.getElementById("local-dev"),
    localName: document.getElementById("local-name"),
    localRoom: document.getElementById("local-room"),
    localUrl: document.getElementById("local-url"),
    pinBar: document.getElementById("pin-bar"),
    modal: document.getElementById("modal"),
    modalText: document.getElementById("modal-text"),
    modalOk: document.getElementById("modal-ok"),
    modalCancel: document.getElementById("modal-cancel"),
    textEditor: document.getElementById("text-editor"),
    toolButtons: [...document.querySelectorAll("[data-tool]")],
    pinButtons: [...document.querySelectorAll("[data-pin]")],
  };

  function setBoot(text) {
    els.boot.hidden = false;
    els.bootText.textContent = text;
  }

  function hideBoot() {
    els.boot.hidden = true;
  }

  function setStatus(status) {
    els.status.textContent = status;
    els.status.dataset.status = status;
  }

  function setMaps(maps, current) {
    els.mapSelect.innerHTML = "";
    for (const map of maps) {
      const opt = document.createElement("option");
      opt.value = map.id;
      opt.textContent = map.available === false ? `${map.name}  ·  NO IMAGE` : map.name;
      els.mapSelect.appendChild(opt);
    }
    if (current) els.mapSelect.value = current;
  }

  function setCurrentMap(id) {
    if ([...els.mapSelect.options].some((o) => o.value === id)) {
      els.mapSelect.value = id;
    }
  }

  function setZoom(label) {
    els.zoomLabel.textContent = label;
  }

  function renderUsers(users, meId) {
    const list = [...users.values()];
    els.usersTop.textContent = String(list.length);
    els.usersBar.innerHTML = "";
    for (const user of list) {
      const chip = document.createElement("div");
      chip.className = "user-chip";
      chip.style.setProperty("--user-color", user.color || "#c9a227");
      if (user.id === meId) chip.classList.add("me");
      const src = avatarUrl(user);
      if (src) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = "";
        img.referrerPolicy = "no-referrer";
        img.onerror = () => img.replaceWith(initials(user));
        chip.appendChild(img);
      } else {
        chip.appendChild(initials(user));
      }
      const name = document.createElement("span");
      name.textContent = user.username || "Operator";
      chip.appendChild(name);
      els.usersBar.appendChild(chip);
    }
  }

  function initials(user) {
    const el = document.createElement("i");
    el.textContent = (user.username || "?").slice(0, 1).toUpperCase();
    return el;
  }

  function setTool(tool) {
    for (const btn of els.toolButtons) {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    }
    els.pinBar.hidden = tool !== TOOL.PIN;
  }

  function setPinType(type) {
    for (const btn of els.pinButtons) {
      btn.classList.toggle("active", btn.dataset.pin === type);
    }
  }

  function confirmClear() {
    return new Promise((resolve) => {
      els.modal.hidden = false;
      els.modalText.textContent = "Clear ALL drawings on this map for everyone in the room?";
      const done = (v) => {
        els.modal.hidden = true;
        els.modalOk.onclick = null;
        els.modalCancel.onclick = null;
        resolve(v);
      };
      els.modalOk.onclick = () => done(true);
      els.modalCancel.onclick = () => done(false);
    });
  }

  function requestText(screen, containerRect) {
    return new Promise((resolve) => {
      const input = els.textEditor;
      input.hidden = false;
      input.value = "";
      const x = Math.min(containerRect.width - 180, Math.max(8, screen.x));
      const y = Math.min(containerRect.height - 36, Math.max(8, screen.y - 14));
      input.style.left = `${x}px`;
      input.style.top = `${y}px`;
      input.focus();
      const finish = (value) => {
        input.hidden = true;
        input.onkeydown = null;
        input.onblur = null;
        resolve(value);
      };
      input.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(input.value.trim());
        } else if (e.key === "Escape") {
          finish("");
        }
      };
      input.onblur = () => finish(input.value.trim());
    });
  }

  function showLocalDev(session) {
    if (session.mode !== "local") {
      els.localDev.hidden = true;
      els.roomLabel.hidden = true;
      return;
    }
    els.localDev.hidden = false;
    els.roomLabel.hidden = false;
    els.localName.value = session.user.username;
    els.localRoom.value = session.roomId;
    const url = new URL(location.href);
    url.searchParams.set("room", session.roomId);
    els.localUrl.value = url.toString();
    els.roomLabel.textContent = `ROOM ${session.roomId}`;
  }

  return {
    els,
    setBoot,
    hideBoot,
    setStatus,
    setMaps,
    setCurrentMap,
    setZoom,
    renderUsers,
    setTool,
    setPinType,
    confirmClear,
    requestText,
    showLocalDev,
    PIN_META,
  };
}
