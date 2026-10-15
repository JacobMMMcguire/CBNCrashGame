// Mock mode (?mock=1): a fake server that runs in the browser.
//
// MOCK ONLY. Crash points come from a fixed list and the seed/commitment are the
// sample values from contract/examples. Nothing here is random or fair.
//
// It exposes the same interface as api.js + realtime.js, and every event and
// response is built by cloning the matching file in contract/examples/ and
// filling in live values, so the UI sees exactly the contract's shapes.

import { ApiError } from "./api.js";

const EXAMPLES = new URL("../../contract/examples/", import.meta.url);
const EVENT_TYPES = [
  "round.betting", "round.launched", "round.tick", "round.cashout",
  "round.crashed", "round.settled", "balance.updated", "history.updated",
];
const RESPONSES = ["config", "account", "current_round", "place_bet", "cash_out", "history", "verify"];
const SEQUENCE = [184, 312, 100, 2460, 247, 1240, 137, 10450, 566, 205]; // crash points in hundredths
const LATENCY_MS = 60;

const clone = (o) => JSON.parse(JSON.stringify(o));
const iso = (ms) => new Date(ms).toISOString();
const units = (credits) => Math.round(Number(credits) * 100);
const credits = (u) => (u < 0 ? "-" : "") + (Math.abs(u) / 100).toFixed(2);
const later = (value) => new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
const fail = (code, message, status = 409) => new Promise((_, reject) =>
  setTimeout(() => reject(new ApiError(code, message, status)), LATENCY_MS));

async function loadTemplates() {
  const get = async (path) => {
    const res = await fetch(new URL(path, EXAMPLES));
    if (!res.ok) throw new Error(`mock: cannot load contract/examples/${path} (HTTP ${res.status})`);
    return res.json();
  };
  const events = Object.fromEntries(await Promise.all(EVENT_TYPES.map(async (t) => [t, await get(`events/${t}.json`)])));
  const responses = Object.fromEntries(await Promise.all(RESPONSES.map(async (r) => [r, await get(`responses/${r}.json`)])));
  return { events, responses };
}

export async function createMockBackend() {
  const tpl = await loadTemplates();
  const config = clone(tpl.responses.config);
  const growth = config.growthRate;
  const seed = tpl.events["round.crashed"].data.serverSeed;
  const commitment = tpl.events["round.betting"].data.commitment;

  let balance = units(config.startingBalance);
  let roundNo = 0;
  let round = null;
  let bet = null;
  let history = [];
  let seq = 0;
  let listener = null;

  const multiplierAt = (now) =>
    Math.min(Math.floor(Math.exp((growth * (now - round.launchedAt)) / 1000) * 100), round.crash - 1);

  function emit(type, data) {
    const ev = clone(tpl.events[type]);
    ev.seq = ++seq;
    if ("roundId" in ev) ev.roundId = round.roundId;
    ev.data = { ...ev.data, ...data };
    listener?.(ev);
  }

  function startRound() {
    roundNo += 1;
    const now = Date.now();
    round = {
      roundId: `r_${roundNo}`, state: "betting", closesAt: now + config.bettingWindowMs,
      launchedAt: null, crashAt: null, crash: SEQUENCE[(roundNo - 1) % SEQUENCE.length],
    };
    bet = null;
    emit("round.betting", { commitment, closesAt: iso(round.closesAt) });
    setTimeout(launch, config.bettingWindowMs);
  }

  function launch() {
    round.state = "in-flight";
    round.launchedAt = Date.now();
    round.crashAt = round.launchedAt + Math.ceil((Math.log(round.crash / 100) / growth) * 1000);
    emit("round.launched", { launchedAt: iso(round.launchedAt), growthRate: growth });
    tick();
  }

  function tick() {
    const now = Date.now();
    if (now >= round.crashAt) return crash();
    const m = multiplierAt(now);
    if (bet?.status === "active" && bet.auto !== null && bet.auto <= m) cashOutAt(bet.auto, true);
    emit("round.tick", { multiplier: m / 100, elapsedMs: now - round.launchedAt });
    setTimeout(tick, Math.min(config.tickIntervalMs, round.crashAt - now));
  }

  function crash() {
    round.state = "crashed";
    if (bet?.status === "active") {
      if (bet.auto !== null && bet.auto < round.crash) cashOutAt(bet.auto, true);
      else bet.status = "lost";
    }
    emit("round.crashed", { crash: round.crash / 100, serverSeed: seed, commitment });
    round.state = "settled";
    let myResult = null;
    if (bet) {
      myResult = { wager: credits(bet.wager), status: bet.status, profit: credits((bet.payout || 0) - bet.wager) };
      if (bet.status === "cashed-out") myResult.multiplier = bet.multiplier / 100;
    }
    history.unshift({ roundId: round.roundId, crash: round.crash / 100, myResult });
    history = history.slice(0, 100);
    emit("round.settled", {});
    emit("history.updated", { round: { roundId: round.roundId, crash: round.crash / 100 } });
    setTimeout(startRound, config.settleDelayMs);
  }

  function cashOutAt(m, auto) {
    bet.status = "cashed-out";
    bet.multiplier = m;
    bet.payout = Math.floor((bet.wager * m) / 100);
    balance += bet.payout;
    emit("round.cashout", { betId: bet.betId, multiplier: m / 100, payout: credits(bet.payout), auto });
    emit("balance.updated", { balance: credits(balance), reason: "cashout" });
  }

  function cashOutResponse() {
    return {
      ...clone(tpl.responses.cash_out), betId: bet.betId, multiplier: bet.multiplier / 100,
      payout: credits(bet.payout), profit: credits(bet.payout - bet.wager), balance: credits(balance),
    };
  }

  const api = {
    health: () => later({ status: "ok", contractVersion: config.contractVersion, state: round.state }),
    config: () => later(clone(config)),
    account: () => later({ ...clone(tpl.responses.account), accountId: "acc_mock", balance: credits(balance) }),
    history: (limit = 20) => later({ rounds: clone(history.slice(0, limit)) }),
    currentRound() {
      const body = {
        ...clone(tpl.responses.current_round), roundId: round.roundId, state: round.state, commitment,
        closesAt: iso(round.closesAt), launchedAt: round.launchedAt ? iso(round.launchedAt) : null,
        growthRate: growth, serverTime: iso(Date.now()),
        myBet: bet && { wager: credits(bet.wager), autoCashOut: bet.auto === null ? null : bet.auto / 100, status: bet.status },
      };
      if (round.state === "crashed" || round.state === "settled") Object.assign(body, { crash: round.crash / 100, serverSeed: seed });
      return later(body);
    },
    placeBet(roundId, wager, autoCashOut = null) {
      if (roundId !== round.roundId || round.state !== "betting" || Date.now() >= round.closesAt)
        return fail("BET_WINDOW_CLOSED", "Betting window is closed.");
      if (bet) return fail("ALREADY_BET", "Already bet this round.");
      const w = units(wager);
      if (w < units(config.minBet) || w > units(config.maxBet)) return fail("BET_OUT_OF_RANGE", "Out of range.", 422);
      if (w > balance) return fail("INSUFFICIENT_BALANCE", "Not enough credits.", 422);
      balance -= w;
      bet = { betId: `b_${roundNo}`, wager: w, auto: autoCashOut === null ? null : Math.round(autoCashOut * 100), status: "active" };
      emit("balance.updated", { balance: credits(balance), reason: "bet" });
      return later({
        ...clone(tpl.responses.place_bet), betId: bet.betId, roundId, wager: credits(w),
        autoCashOut, status: "active", balance: credits(balance),
      });
    },
    cashOut(roundId) {
      if (bet?.status === "cashed-out" && roundId === round.roundId) return later(cashOutResponse());
      if (!bet || roundId !== round.roundId) return fail("NO_ACTIVE_BET", "No active bet.");
      if (bet.status === "lost" || round.state !== "in-flight" && round.state !== "betting") return fail("TOO_LATE", "Too late.");
      if (round.state === "betting") return fail("ROUND_NOT_IN_FLIGHT", "Not launched yet.");
      const now = Date.now();
      if (now >= round.crashAt) return fail("TOO_LATE", "Too late.");
      cashOutAt(multiplierAt(now), false);
      return later(cashOutResponse());
    },
    devSkip() {
      if (round.state !== "in-flight") return fail("ROUND_NOT_IN_FLIGHT", "Not in flight.");
      // Same as the server: move the launch back so the multiplier rises by 5.00x.
      const now = Date.now();
      const current = Math.floor(Math.exp((growth * (now - round.launchedAt)) / 1000) * 100);
      const shift = Math.ceil((Math.log((current + 500) / 100) / growth) * 1000) - (now - round.launchedAt);
      round.launchedAt -= shift;
      round.crashAt -= shift;
      return later({ launchedAt: iso(round.launchedAt), multiplier: Math.min(current + 500, round.crash - 1) / 100 });
    },
    verify(roundId) {
      const h = history.find((r) => r.roundId === roundId);
      if (!h) return fail("ROUND_NOT_FOUND", "Unknown round.", 404);
      return later({ ...clone(tpl.responses.verify), roundId, crash: h.crash, valid: false });
    },
  };

  function createRealtime({ onEvent, onStatus, onResync }) {
    return {
      start() {
        listener = onEvent;
        onStatus("mock");
        if (!round) startRound();
        onResync();
      },
      stop() { listener = null; },
    };
  }

  return { api, createRealtime };
}
