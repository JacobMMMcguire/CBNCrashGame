// Phone page: /join/<code>. Pick a name, then bet and cash out with big buttons.
//
// Joining is POST /api/v1/rooms/<code>/players. The server checks the name,
// makes the player id and a session token, and the token is kept on this
// device (localStorage ascent-session:<code>). Reopening the page sends that
// token in the WebSocket hello, and the server puts the player back in the
// same seat with the same balance. The phone only sends actions; every
// amount, multiplier and result shown here comes from the server.

import { applyI18n, formatCredits, formatMultiplier, formatNumber, parseCreditsInput, setLanguage, t } from "../i18n.js";
import { createRoomSocket, store } from "./socket.js";
import { createRound, applyRoundEvent, loadSnapshot, renderStage } from "./round.js";
import { renderLeaderboard } from "./leaderboard.js";

const PHONE_LB_ROWS = 5;

const $ = (id) => document.getElementById(id);
const code = (location.pathname.match(/^\/join\/([A-Za-z0-9]{4})\/?$/)?.[1] || "").toUpperCase();
const tokenKey = `ascent-session:${code}`;
const view = { you: null, room: null, config: null, round: createRound(), bet: null, socket: null, busy: false };
const keys = new Map(); // "<roundId>:<action>" -> Idempotency-Key, reused when a tap is retried

function show(id) {
  for (const s of ["codeForm", "nameForm", "notice", "play"]) $(s).hidden = s !== id;
}

function notice(text) {
  $("noticeText").textContent = text;
  show("notice");
}

function showError(el, text) {
  el.textContent = text || "";
  el.hidden = !text;
}

function errorText(body) {
  const c = body?.error?.code;
  return c ? t(`room.error.${c}`) : t("room.error.generic");
}

function setConn(status) {
  $("conn").dataset.status = status;
  $("conn").textContent = t(`conn.${status}`);
}

/** UUID v4 from getRandomValues: crypto.randomUUID needs https, and LAN play is plain http. */
function uuid4() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function keyFor(action) {
  const k = `${view.round.roundId}:${action}`;
  if (!keys.has(k)) keys.set(k, uuid4());
  return keys.get(k);
}

// ---------- Join ----------

async function loadRoom() {
  $("roomLabel").textContent = t("room.join.roomLabel", { code });
  let res;
  try {
    res = await fetch(`/api/v1/rooms/${code}`);
  } catch {
    notice(t("room.error.offline"));
    return;
  }
  if (res.status === 404) { notice(t("room.error.ROOM_NOT_FOUND")); return; }
  const info = await res.json();
  $("startingNote").textContent = t("room.join.startingNote", { b: formatCredits(info.startingBalance) });
  if (store.get(tokenKey)) connect();
  else showNameForm();
}

function showNameForm(message) {
  show("nameForm");
  showError($("joinError"), message);
  $("nameInput").focus();
}

async function join(e) {
  e.preventDefault();
  const name = $("nameInput").value.trim();
  if (!name) return;
  $("joinBtn").disabled = true;
  showError($("joinError"), "");
  try {
    const res = await fetch(`/api/v1/rooms/${code}/players`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    });
    const body = await res.json();
    if (!res.ok) { showError($("joinError"), errorText(body)); return; }
    store.set(tokenKey, body.sessionToken);
    connect();
  } catch {
    showError($("joinError"), t("room.error.offline"));
  } finally {
    $("joinBtn").disabled = false;
  }
}

function connect() {
  view.socket?.stop();
  view.socket = createRoomSocket({
    code, role: "player",
    token: () => store.get(tokenKey),
    onStatus: setConn,
    onMessage,
    onRejected: (reason) => {
      store.remove(tokenKey);
      if (reason === "kicked") notice(t("room.join.kicked"));
      else if (reason === "notFound") notice(t("room.error.ROOM_NOT_FOUND"));
      else showNameForm(t("room.join.seatReleased"));
    },
  });
}

// ---------- Play ----------

function onMessage(msg) {
  const d = msg.data;
  switch (msg.type) {
    case "welcome":
      view.you = d.you;
      view.room = d.room;
      view.config = d.config;
      loadSnapshot(view.round, d);
      view.bet = d.round.myBet;
      $("meName").textContent = d.you.name;
      setBalance(d.you.balance);
      renderChips();
      renderLeaderboard($("lbList"), d.leaderboard, { me: d.you.playerId, limit: PHONE_LB_ROWS });
      show("play");
      break;
    case "leaderboard.updated":
      renderLeaderboard($("lbList"), d, { me: view.you?.playerId, limit: PHONE_LB_ROWS });
      break;
    case "lobby.updated":
      view.room = { ...view.room, locked: d.locked, started: d.started };
      break;
    case "balance.updated":
      setBalance(d.balance);
      break;
    case "round.cashout":
      if (view.bet) view.bet.status = "cashed-out";
      setResult(t("room.join.cashedOut", { m: formatMultiplier(d.multiplier), p: formatCredits(d.payout) }), "win");
      break;
    case "round.betting":
      applyRoundEvent(view.round, msg);
      view.bet = null;
      setResult("");
      break;
    case "round.crashed":
      applyRoundEvent(view.round, msg);
      if (view.bet?.status === "active") {
        view.bet.status = "lost";
        setResult(t("room.join.lost", { c: formatMultiplier(d.crash), w: formatCredits(view.bet.wager) }), "lost");
      }
      break;
    default:
      applyRoundEvent(view.round, msg);
  }
  render();
}

function setBalance(balance) {
  $("meBalance").textContent = formatCredits(balance);
}

function setResult(text, tone = "") {
  $("result").textContent = text;
  $("result").dataset.tone = tone;
}

function renderChips() {
  $("chips").replaceChildren(...view.config.quickBetChips.map((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = formatNumber(c);
    b.addEventListener("click", () => { $("wagerInput").value = formatNumber(c); render(); });
    return b;
  }));
}

function render() {
  if (!view.room) return;
  renderStage($("stage"), view.round, view.room.started);
  const btn = $("actionBtn");
  const state = view.round.state;
  const bet = view.bet;
  let label, enabled = false, mode = "bet";
  if (state === "betting" && !bet) {
    const wager = parseCreditsInput($("wagerInput").value);
    label = wager ? t("room.join.placeBet", { w: formatCredits(wager) }) : t("room.join.enterWager");
    enabled = !!wager;
  } else if (state === "betting") {
    label = t("room.join.betPlaced", { w: formatCredits(bet.wager) });
  } else if (state === "in-flight" && bet?.status === "active") {
    label = t("room.join.cashOut");
    enabled = true;
    mode = "cashout";
  } else if (!view.room.started) {
    label = t("room.phase.waitingHost");
  } else {
    label = t("room.join.nextRound");
  }
  btn.textContent = label;
  btn.disabled = !enabled || view.busy;
  btn.dataset.mode = mode;
  $("betPanel").hidden = !(state === "betting" && !bet);
}

async function onAction() {
  const r = view.round;
  showError($("playError"), "");
  view.busy = true;
  render();
  try {
    if (r.state === "betting" && !view.bet) {
      const wager = parseCreditsInput($("wagerInput").value);
      if (!wager) return;
      const reply = await view.socket.send("place_bet", { roundId: r.roundId, wager, idempotencyKey: keyFor("bet") });
      if (reply.status === 201) view.bet = { wager: reply.body.wager, status: "active" };
      else showError($("playError"), errorText(reply.body));
    } else if (r.state === "in-flight" && view.bet?.status === "active") {
      const reply = await view.socket.send("cash_out", { roundId: r.roundId, idempotencyKey: keyFor("cashout") });
      if (reply.status === 200) {
        view.bet.status = "cashed-out";
        setResult(t("room.join.cashedOut", { m: formatMultiplier(reply.body.multiplier), p: formatCredits(reply.body.payout) }), "win");
      } else {
        showError($("playError"), errorText(reply.body));
      }
    }
  } catch {
    showError($("playError"), t("room.error.offline")); // same key is reused if tapped again
  } finally {
    view.busy = false;
    render();
  }
}

async function main() {
  await setLanguage(store.get("ascent-lang") === "fr" ? "fr" : "en");
  applyI18n();
  setConn("connecting");
  $("codeForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const c = $("codeInput").value.trim().toUpperCase();
    if (/^[A-Z0-9]{4}$/.test(c)) location.href = `/join/${c}`;
  });
  $("nameForm").addEventListener("submit", join);
  $("actionBtn").addEventListener("click", onAction);
  $("wagerInput").addEventListener("input", render);
  setInterval(render, 100);
  if (code) loadRoom();
  else { setConn("offline"); show("codeForm"); $("codeInput").focus(); }
}

main();
