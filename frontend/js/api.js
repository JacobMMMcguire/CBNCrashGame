// HTTP client for the game API (docs/GAME_CONTRACT.md §8).
// Every bet and cash-out attempt gets its own Idempotency-Key (§7). A retry
// after a network failure reuses the same key, so it can never apply twice.

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function uuidv4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Guest identity: a random token kept in this browser. `slot` gives a separate
 * player in the same browser (the page passes ?player=2), for testing multiplayer.
 */
export function guestToken(slot = "") {
  const KEY = "ascent-guest-token" + (slot ? `-${slot}` : "");
  try {
    let token = localStorage.getItem(KEY);
    if (!token) {
      token = "guest-" + uuidv4();
      localStorage.setItem(KEY, token);
    }
    return token;
  } catch {
    return "guest-" + uuidv4(); // storage blocked: a fresh play account per page load
  }
}

export function createApi({ base, token }) {
  async function request(method, path, { body, idempotent = false } = {}) {
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotent) headers["Idempotency-Key"] = uuidv4();
    const init = { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };

    let res;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await fetch(base + path, init);
        break;
      } catch (err) {
        if (attempt >= 1) throw new ApiError("NETWORK", String(err), 0);
      }
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const e = data?.error;
      throw new ApiError(e?.code || "UNKNOWN", e?.message || res.statusText, res.status);
    }
    return data;
  }

  return {
    health: () => request("GET", "/health"),
    config: () => request("GET", "/config"),
    account: () => request("GET", "/account"),
    refill: () => request("POST", "/account/refill", { body: {} }),
    setName: (name) => request("POST", "/account/name", { body: { name } }),
    players: () => request("GET", "/players"),
    currentRound: () => request("GET", "/rounds/current"),
    history: (limit = 20) => request("GET", `/history?limit=${limit}`),
    verify: (roundId) => request("GET", `/rounds/${encodeURIComponent(roundId)}/verify`),
    placeBet: (roundId, wager, autoCashOut = null) =>
      request("POST", `/rounds/${encodeURIComponent(roundId)}/bets`, { body: { wager, autoCashOut }, idempotent: true }),
    cashOut: (roundId) =>
      request("POST", `/rounds/${encodeURIComponent(roundId)}/cashout`, { body: {}, idempotent: true }),
    /** Testing cheat ("rectangle"); 404 unless the server runs with ASCENT_DEV_CHEATS=1. */
    devSkip: () => request("POST", "/dev/skip", { body: {} }),
  };
}
