// Round state for the room pages, built only from what the server sends:
// the welcome snapshot and round.* events. The pages never compute an
// outcome; they only show the server's multiplier, phase and crash point.

import { formatMultiplier, t } from "../i18n.js";

export function createRound() {
  return { roundId: null, state: "idle", closesAt: null, multiplier: 1, crash: null, offsetMs: 0, history: [] };
}

/** Load GET /rounds/current-style snapshot from the welcome message. */
export function loadSnapshot(r, welcome) {
  const snap = welcome.round;
  r.offsetMs = Date.parse(welcome.serverTime) - Date.now();
  r.roundId = snap.roundId;
  r.state = snap.state;
  r.closesAt = snap.closesAt ? Date.parse(snap.closesAt) : null;
  r.crash = snap.crash ?? null;
  r.multiplier = snap.crash ?? 1;
  r.history = (welcome.history || []).map((h) => h.crash);
  return r;
}

/** Apply one server event. Returns true if it was a round event. */
export function applyRoundEvent(r, msg) {
  switch (msg.type) {
    case "round.betting":
      Object.assign(r, { roundId: msg.roundId, state: "betting", closesAt: Date.parse(msg.data.closesAt),
        multiplier: 1, crash: null });
      return true;
    case "round.launched":
      Object.assign(r, { state: "in-flight", multiplier: 1 });
      return true;
    case "round.tick":
      r.multiplier = msg.data.multiplier;
      return true;
    case "round.crashed":
      Object.assign(r, { state: "crashed", crash: msg.data.crash, multiplier: msg.data.crash });
      return true;
    case "round.settled":
      r.state = "settled";
      return true;
    case "history.updated":
      r.history = [msg.data.round.crash, ...r.history].slice(0, 10);
      return true;
    default:
      return false;
  }
}

export function secondsLeft(r) {
  if (r.state !== "betting" || !r.closesAt) return 0;
  return Math.max(0, Math.ceil((r.closesAt - (Date.now() + r.offsetMs)) / 1000));
}

/** Text for the phase line under the multiplier. */
export function phaseText(r, started) {
  if (!started && (r.state === "idle" || r.state === "settled")) return t("room.phase.waitingHost");
  switch (r.state) {
    case "betting": return t("room.phase.betting", { s: secondsLeft(r) });
    case "in-flight": return t("room.phase.flying");
    case "crashed": return t("room.phase.crashed", { c: formatMultiplier(r.crash) });
    case "settled": return t("room.phase.settled");
    default: return t("room.phase.idle");
  }
}

/** Fill a .stage element: multiplier, phase line and recent crash points. */
export function renderStage(el, r, started) {
  el.dataset.state = r.state;
  el.querySelector("[data-multiplier]").textContent = formatMultiplier(r.state === "betting" ? 1 : r.multiplier);
  el.querySelector("[data-phase]").textContent = phaseText(r, started);
  const list = el.querySelector("[data-history]");
  if (list) {
    list.replaceChildren(...r.history.map((c) => {
      const li = document.createElement("li");
      li.textContent = formatMultiplier(c);
      li.dataset.high = c >= 2 ? "true" : "false";
      return li;
    }));
  }
}
