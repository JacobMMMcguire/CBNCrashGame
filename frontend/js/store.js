// One observable state object for the whole UI. Components subscribe and
// render from it; only main.js (event handlers and actions) writes to it.

export const initialState = {
  mode: "live",            // "live" | "mock"
  connection: "connecting", // "connecting" | "open" | "reconnecting" | "offline" | "mock"
  config: null,            // GET /api/v1/config
  lang: "en",
  balance: null,           // credit string, e.g. "1000.00"
  round: { roundId: null, state: "idle", commitment: null, closesAt: null, launchedAt: null, crash: null, serverSeed: null },
  multiplier: 1,           // last round.tick value
  myBet: null,             // { wager, autoCashOut, status, multiplier?, payout? }
  history: [],             // [{ roundId, crash, myResult }], newest first
  pending: null,           // "bet" | "cashout" while a request is in flight
  error: null,             // last error code, e.g. "TOO_LATE"
  clockOffsetMs: 0,        // serverTime - Date.now(), for the betting countdown
  wagerText: "",
  autoText: "2.00",
  autoOn: false,
  queued: false,           // "Bet next launch": place the bet as soon as boarding opens
  session: { startedAt: Date.now(), rounds: 0, wagered: 0, net: 0, best: null },
  verify: null,
  me: null,                // { playerId, name }
  players: [],             // round.players roster: [{ playerId, name, wager, status, multiplier?, payout? }]
  online: 0,               // distinct players connected
  notice: null,            // { text, n }: a one-off toast (e.g. the testing cheat)            // { roundId, status: "loading" | "done" | "error", data?, check? }
};

export function createStore(initial) {
  let state = initial;
  const subscribers = new Set();
  return {
    get: () => state,
    set(patch) {
      const prev = state;
      state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      subscribers.forEach((fn) => fn(state, prev));
    },
    subscribe(fn) {
      subscribers.add(fn);
      fn(state, null);
      return () => subscribers.delete(fn);
    },
  };
}

/** The four player-facing phases from DESIGN.md, derived from the round state and my bet. */
export function uiPhase(s) {
  const cashed = s.myBet?.status === "cashed-out";
  switch (s.round.state) {
    case "in-flight": return cashed ? "ejected" : "flying";
    case "crashed":
    case "settled": return cashed ? "ejected" : "aborted";
    default: return "boarding";
  }
}

/** Write text only when it changed (keeps live regions from re-announcing). */
export function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}
