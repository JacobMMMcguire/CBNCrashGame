// Host screen: create a room, show how to join, run the lobby and the round.
//
// The host token comes from POST /api/v1/rooms and is kept in localStorage
// under ascent-host:<code>, so reloading /host?room=<code> reconnects as host.
// Every control (start, lock, kick) is a WebSocket action that the server
// checks against that token.

import { applyI18n, setLanguage, t } from "../i18n.js";
import { createRoomSocket, store } from "./socket.js";
import { createRound, applyRoundEvent, loadSnapshot, renderStage } from "./round.js";
import { renderLeaderboard } from "./leaderboard.js";
import { qrSvg } from "./qr.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const view = { code: null, room: null, lobby: { players: [] }, round: createRound(), socket: null };

function showError(el, text) {
  el.textContent = text || "";
  el.hidden = !text;
}

function errorText(reply) {
  const code = reply?.body?.error?.code;
  return code ? t(`room.error.${code}`) : t("room.error.generic");
}

function setConn(status) {
  const el = $("conn");
  el.dataset.status = status;
  el.textContent = t(`conn.${status}`);
}

async function hostGame() {
  $("hostBtn").disabled = true;
  try {
    const res = await fetch("/api/v1/rooms", { method: "POST" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const room = await res.json();
    store.set(`ascent-host:${room.roomCode}`, room.hostToken);
    history.replaceState(null, "", `/host?room=${room.roomCode}`);
    connect(room.roomCode);
  } catch (err) {
    console.warn(err);
    showError($("introError"), t("room.error.generic"));
    $("hostBtn").disabled = false;
  }
}

function connect(code) {
  view.code = code;
  $("intro").hidden = true;
  $("hostGrid").hidden = false;
  view.socket = createRoomSocket({
    code, role: "host",
    token: () => store.get(`ascent-host:${code}`),
    onStatus: setConn,
    onMessage,
    onRejected: (reason) => {
      store.remove(`ascent-host:${code}`);
      $("hostGrid").hidden = true;
      $("intro").hidden = false;
      $("hostBtn").disabled = false;
      showError($("introError"), t(reason === "notFound" ? "room.host.roomGone" : "room.host.notHost"));
      history.replaceState(null, "", "/host");
    },
  });
}

function onMessage(msg) {
  if (msg.type === "welcome") {
    view.room = msg.data.room;
    view.lobby = msg.data.lobby;
    loadSnapshot(view.round, msg.data);
    renderJoin();
    renderLobby();
    renderControls();
    renderLeaderboard($("lbList"), msg.data.leaderboard);
  } else if (msg.type === "leaderboard.updated") {
    renderLeaderboard($("lbList"), msg.data);
  } else if (msg.type === "lobby.updated") {
    view.lobby = msg.data;
    view.room = { ...view.room, locked: msg.data.locked, started: msg.data.started };
    renderLobby();
    renderControls();
  } else if (applyRoundEvent(view.round, msg)) {
    // the stage redraws on its timer
  }
}

/** The join link is built here from the server's PUBLIC_BASE_URL. */
export function joinUrl(publicBaseUrl, code) {
  return `${publicBaseUrl.replace(/\/+$/, "")}/join/${encodeURIComponent(code)}`;
}

function renderJoin() {
  const url = joinUrl(view.room.publicBaseUrl, view.room.roomCode);
  $("roomCode").textContent = view.room.roomCode;
  const cut = url.lastIndexOf("/join/");
  $("joinUrl").replaceChildren(url.slice(0, cut), document.createElement("wbr"), url.slice(cut));
  const svg = qrSvg(url, { label: t("room.host.qrLabel", { code: view.room.roomCode }) });
  $("qr").replaceChildren(...(svg ? [svg] : []));
  const host = new URL(url).hostname;
  $("localWarn").hidden = !["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(host);
  document.title = `Ascent · ${view.room.roomCode}`;
}

function renderLobby() {
  const players = view.lobby.players;
  $("playerCount").textContent = `(${players.length})`;
  $("lobbyEmpty").hidden = players.length > 0;
  $("lobbyList").replaceChildren(...players.map((p) => {
    const li = document.createElement("li");
    li.className = "lobby-item";
    li.dataset.connected = String(p.connected);
    const name = document.createElement("span");
    name.className = "lobby-item__name";
    name.textContent = p.name;
    const status = document.createElement("span");
    status.className = "lobby-item__status";
    status.textContent = t(p.connected ? "room.host.online" : "room.host.away");
    const kick = document.createElement("button");
    kick.type = "button";
    kick.className = "btn btn--ghost btn--sm";
    kick.textContent = t("room.host.kick");
    kick.setAttribute("aria-label", t("room.host.kickName", { name: p.name }));
    kick.addEventListener("click", () => kickPlayer(p));
    li.append(name, status, kick);
    return li;
  }));
}

function renderControls() {
  const { started, locked } = view.room;
  $("startBtn").disabled = started;
  $("startBtn").textContent = t(started ? "room.host.running" : "room.host.start");
  $("lockBtn").setAttribute("aria-pressed", String(locked));
  $("lockBtn").textContent = t(locked ? "room.host.unlock" : "room.host.lock");
}

async function hostAction(type, fields) {
  showError($("hostError"), "");
  try {
    const reply = await view.socket.send(type, fields);
    if (reply.status >= 400) showError($("hostError"), errorText(reply));
  } catch {
    showError($("hostError"), t("room.error.offline"));
  }
}

function kickPlayer(p) {
  if (confirm(t("room.host.kickConfirm", { name: p.name }))) hostAction("kick", { playerId: p.playerId });
}

async function main() {
  const lang = store.get("ascent-lang") === "fr" ? "fr" : "en";
  await setLanguage(lang);
  applyI18n();
  setConn("connecting");
  $("hostBtn").addEventListener("click", hostGame);
  $("startBtn").addEventListener("click", () => hostAction("start"));
  $("lockBtn").addEventListener("click", () => hostAction("lock", { locked: !view.room.locked }));
  setInterval(() => { if (view.room) renderStage($("stage"), view.round, view.room.started); }, 100);

  const code = (params.get("room") || "").toUpperCase();
  if (code && store.get(`ascent-host:${code}`)) connect(code);
  else setConn("offline");
}

main();
