// Bootstrap: pick the live server or mock mode (?mock=1), load config and
// strings, mount components, and turn server events into store updates.
//
// Optional query parameters:
//   ?mock=1                      run a fake round loop in the browser (no server)
//   ?api=http://127.0.0.1:8001   use a server on another origin (must be in corsAllowOrigins)

import { ApiError, createApi, guestToken } from "./api.js";
import { createRealtime, websocketUrl } from "./realtime.js";
import { createStore, initialState } from "./store.js";
import { parseCreditsInput, parseMultiplierInput, setLanguage, t } from "./i18n.js";
import { mountHeader } from "./components/header.js";
import { mountStage } from "./components/stage.js";
import { mountControls } from "./components/controls.js";
import { mountHistory } from "./components/history.js";
import { mountFair } from "./components/fair.js";
import { mountSession } from "./components/session.js";

const params = new URLSearchParams(location.search);
const isMock = params.get("mock") === "1";
const store = createStore({ ...initialState, mode: isMock ? "mock" : "live" });

const pref = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage blocked: not remembered */ } },
};

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  store.set({ theme });
}
applyTheme(pref.get("ascent-theme") === "day" ? "day" : "mission");

async function createBackend() {
  if (isMock) {
    document.getElementById("mockBanner").hidden = false;
    const { createMockBackend } = await import("./mock.js");
    return createMockBackend();
  }
  const base = (params.get("api") || "").replace(/\/$/, "") + "/api/v1";
  const token = guestToken();
  return {
    api: createApi({ base, token }),
    createRealtime: (handlers) => createRealtime({ ...handlers, url: websocketUrl(base, token) }),
  };
}

async function untilOk(fn) {
  const banner = document.getElementById("bootError");
  for (;;) {
    try {
      const value = await fn();
      banner.hidden = true;
      return value;
    } catch (err) {
      console.warn("boot:", err);
      banner.textContent = t("boot.error");
      banner.hidden = false;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

function errorCode(err) {
  return err instanceof ApiError ? err.code : "UNKNOWN";
}

async function boot() {
  const stored = pref.get("ascent-lang");
  await setLanguage(stored === "fr" ? "fr" : "en");
  const backend = await untilOk(createBackend);
  const { api } = backend;
  const config = await untilOk(() => api.config());
  const lang = config.supportedLanguages.includes(stored) ? stored : config.defaultLanguage;
  await setLanguage(lang);
  const defaultWager = config.quickBetChips.includes("100.00") ? "100.00" : config.minBet;
  store.set({ config, lang, wagerText: defaultWager });

  // ---------- Resync from GET endpoints (on connect and on a seq gap) ----------
  let syncing = null;
  function resync() {
    syncing ??= (async () => {
      try {
        const [account, cur, hist] = await Promise.all([api.account(), api.currentRound(), api.history(20)]);
        store.set({
          balance: account.balance,
          round: {
            roundId: cur.roundId, state: cur.state, commitment: cur.commitment, closesAt: cur.closesAt,
            launchedAt: cur.launchedAt, crash: cur.crash ?? null, serverSeed: cur.serverSeed ?? null,
          },
          myBet: cur.myBet ? { ...cur.myBet } : null,
          history: hist.rounds,
          clockOffsetMs: Date.parse(cur.serverTime) - Date.now(),
        });
      } catch (err) {
        console.warn("resync failed:", err);
      } finally {
        syncing = null;
      }
    })();
    return syncing;
  }

  // ---------- Server events -> store (GAME_CONTRACT.md §9) ----------
  function onEvent(msg) {
    const s = store.get();
    const sameRound = msg.roundId === undefined || msg.roundId === s.round.roundId;
    const d = msg.data;
    switch (msg.type) {
      case "round.betting":
        store.set({
          round: { roundId: msg.roundId, state: "betting", commitment: d.commitment, closesAt: d.closesAt,
                   launchedAt: null, crash: null, serverSeed: null },
          myBet: null, multiplier: 1, error: null,
        });
        break;
      case "round.launched":
        if (!sameRound) return void resync();
        store.set({ round: { ...s.round, state: "in-flight", launchedAt: d.launchedAt }, multiplier: 1 });
        break;
      case "round.tick":
        if (!sameRound) return void resync();
        store.set({ multiplier: d.multiplier, round: s.round.state === "in-flight" ? s.round : { ...s.round, state: "in-flight" } });
        break;
      case "round.cashout":
        if (!sameRound) return;
        store.set({ myBet: { ...s.myBet, status: "cashed-out", multiplier: d.multiplier, payout: d.payout } });
        break;
      case "round.crashed":
        if (!sameRound) return void resync();
        store.set({
          round: { ...s.round, state: "crashed", crash: d.crash, serverSeed: d.serverSeed },
          myBet: s.myBet?.status === "active" ? { ...s.myBet, status: "lost" } : s.myBet,
        });
        break;
      case "round.settled":
        if (sameRound) store.set({ round: { ...s.round, state: "settled" } });
        break;
      case "balance.updated":
        store.set({ balance: d.balance });
        break;
      case "history.updated": {
        const { roundId, crash } = d.round;
        const bet = s.round.roundId === roundId ? s.myBet : null;
        let myResult = null;
        if (bet?.wager !== undefined) {
          const payout = bet.status === "cashed-out" ? Number(bet.payout) : 0;
          myResult = { wager: bet.wager, status: bet.status, profit: (payout - Number(bet.wager)).toFixed(2) };
          if (bet.status === "cashed-out") myResult.multiplier = bet.multiplier;
        }
        store.set({ history: [{ roundId, crash, myResult }, ...s.history.filter((h) => h.roundId !== roundId)].slice(0, 50) });
        break;
      }
    }
  }

  // ---------- Actions ----------
  const actions = {
    async placeBet() {
      const s = store.get();
      const wager = parseCreditsInput(s.wagerText);
      const auto = s.autoText.trim() ? parseMultiplierInput(s.autoText) : null;
      store.set({ pending: "bet", error: null });
      try {
        const r = await api.placeBet(s.round.roundId, wager, auto);
        store.set((st) => ({
          myBet: { ...st.myBet, wager: r.wager, autoCashOut: r.autoCashOut, status: st.myBet?.status ?? "active" },
          balance: r.balance,
        }));
      } catch (err) {
        store.set({ error: errorCode(err) });
      } finally {
        store.set({ pending: null });
      }
    },
    async cashOut() {
      const s = store.get();
      if (s.pending) return;
      store.set({ pending: "cashout", error: null });
      try {
        const r = await api.cashOut(s.round.roundId);
        store.set((st) => ({
          myBet: { ...st.myBet, status: "cashed-out", multiplier: r.multiplier, payout: r.payout },
          balance: r.balance,
        }));
      } catch (err) {
        store.set({ error: errorCode(err) });
      } finally {
        store.set({ pending: null });
      }
    },
    async setLanguage(code) {
      await setLanguage(code);
      pref.set("ascent-lang", code);
      store.set({ lang: code });
    },
    setTheme(theme) {
      pref.set("ascent-theme", theme);
      applyTheme(theme);
    },
  };

  mountHeader(store, actions);
  mountStage(store);
  mountControls(store, actions);
  mountHistory(store);
  mountFair(store);
  mountSession(store);

  backend.createRealtime({ onEvent, onStatus: (connection) => store.set({ connection }), onResync: resync }).start();
}

boot();
