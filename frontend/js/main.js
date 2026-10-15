// Bootstrap: pick the live server or mock mode (?mock=1), load config and
// strings, mount components, and turn server events into store updates.
//
// Optional query parameters:
//   ?mock=1                      run a fake round loop in the browser (no server)
//   ?api=http://127.0.0.1:8001   use a server on another origin (must be in corsAllowOrigins)
//   ?player=2                    play as a second pilot in this browser (testing multiplayer)

import { ApiError, createApi, guestToken } from "./api.js";
import { createRealtime, websocketUrl } from "./realtime.js";
import { createStore, initialState } from "./store.js";
import { formatCredits, parseCreditsInput, parseMultiplierInput, setLanguage, t } from "./i18n.js";
import { verifyRound } from "./fairness.js";
import { createAudio } from "./audio.js";
import { mountStage } from "./components/stage.js";
import { mountData } from "./components/data.js";
import { mountControls } from "./components/controls.js";
import { mountMenu } from "./components/menu.js";

const params = new URLSearchParams(location.search);
const isMock = params.get("mock") === "1";
const store = createStore({ ...initialState, mode: isMock ? "mock" : "live" });

const pref = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage blocked: not remembered */ } },
};

async function createBackend() {
  if (isMock) {
    const { createMockBackend } = await import("./mock.js");
    return createMockBackend();
  }
  const base = (params.get("api") || "").replace(/\/$/, "") + "/api/v1";
  const slot = (params.get("player") || "").replace(/[^a-z0-9]/gi, "").slice(0, 8);
  const token = guestToken(slot);
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
  const defaultWager = config.quickBetChips.includes("10.00") ? "10.00" : config.minBet;
  store.set({
    config, lang, wagerText: pref.get("ascent-wager") || defaultWager,
    autoText: pref.get("ascent-auto") || "2.00", autoOn: pref.get("ascent-auto-on") === "1",
  });

  // ---------- Resync from GET endpoints (on connect and on a seq gap) ----------
  let syncing = null;
  function resync() {
    syncing ??= (async () => {
      try {
        const [account, cur, hist, crew] = await Promise.all([
          api.account(), api.currentRound(), api.history(30), api.players(),
        ]);
        store.set({
          balance: account.balance,
          me: { playerId: account.playerId, name: account.name },
          players: crew.roundId === cur.roundId ? crew.players : [],
          online: crew.online,
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

  function recordSession(myResult) {
    if (!myResult) return;
    store.set((st) => {
      const s = { ...st.session };
      s.rounds += 1;
      s.wagered += Number(myResult.wager);
      s.net += Number(myResult.profit);
      if (myResult.status === "cashed-out") s.best = Math.max(s.best ?? 0, myResult.multiplier);
      return { session: s };
    });
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
        if (s.queued) {
          store.set({ queued: false });
          actions.placeBet();
        }
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
        store.set({ myBet: { ...s.myBet, status: "cashed-out", multiplier: d.multiplier, payout: d.payout, auto: d.auto } });
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
      case "round.players":
        if (sameRound) store.set({ players: d.players, online: d.online });
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
        if (!s.history.some((h) => h.roundId === roundId)) recordSession(myResult);
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
      const auto = s.autoOn && s.autoText.trim() ? parseMultiplierInput(s.autoText) : null;
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
    async refill() {
      store.set({ pending: "refill", error: null });
      try {
        const r = await api.refill();
        store.set({ balance: r.balance, queued: false, notice: { text: t("toast.refilled", { b: formatCredits(r.balance) }), n: Date.now() } });
      } catch (err) {
        store.set({ error: errorCode(err) });
      } finally {
        store.set({ pending: null });
      }
    },
    async setName(name) {
      const r = await api.setName(name);  // errors go back to the form
      store.set({ me: { playerId: r.playerId, name: r.name } });
    },
    setQueued(queued) {
      store.set({ queued, error: null });
    },
    setWager(text) {
      pref.set("ascent-wager", text);
      store.set({ wagerText: text, error: null });
    },
    setAuto(patch) {
      if ("autoText" in patch) pref.set("ascent-auto", patch.autoText);
      if ("autoOn" in patch) pref.set("ascent-auto-on", patch.autoOn ? "1" : "0");
      store.set({ ...patch, error: null });
    },
    /** Testing cheat: jump the current flight forward by +5.00x (server must allow it). */
    async devSkip() {
      const s = store.get();
      try {
        const r = await api.devSkip();
        store.set((st) => ({
          round: st.round.roundId === s.round.roundId ? { ...st.round, launchedAt: r.launchedAt } : st.round,
          multiplier: Math.max(st.multiplier, r.multiplier),
          notice: { text: t("cheat.skipped", { m: r.multiplier.toFixed(2) }), n: Date.now() },
        }));
      } catch (err) {
        const code = errorCode(err);
        const key = code === "ROUND_NOT_IN_FLIGHT" ? "cheat.notFlying" : code === "UNKNOWN" || err.status === 404 ? "cheat.off" : `errors.${code}`;
        store.set({ notice: { text: t(key), n: Date.now() } });
      }
    },
    async verify(roundId) {
      store.set({ verify: { roundId, status: "loading" } });
      try {
        const data = await api.verify(roundId);
        const check = verifyRound(data, store.get().config);
        store.set({ verify: { roundId, status: "done", data, check } });
      } catch (err) {
        store.set({ verify: { roundId, status: "error", code: errorCode(err) } });
      }
    },
    async setLanguage(code) {
      await setLanguage(code);
      pref.set("ascent-lang", code);
      store.set({ lang: code });
    },
  };

  const audio = createAudio({ enabled: pref.get("ascent-sound") !== "0" });
  document.addEventListener("click", (e) => {
    // Soft click for the small controls (chips, steppers, toggles, language)
    if (e.target.closest(".chip, .stepper__btn, .seg button, .switch, .pill")) audio.play("click");
    // A mouse click leaves focus on the button, and Space would then press it again
    // instead of ejecting. Release focus after mouse clicks only (detail > 0), so
    // keyboard users keep their place.
    const button = e.target.closest("button");
    if (button && e.detail > 0 && !button.closest("dialog")) button.blur();
  });

  // Cheat code for testing: type "rectangle" anywhere outside a text field.
  const CHEAT = "rectangle";
  let typed = "";
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    if (e.target.closest?.("input, textarea, [contenteditable]")) return;
    typed = (typed + e.key.toLowerCase()).slice(-CHEAT.length);
    if (typed === CHEAT) {
      typed = "";
      actions.devSkip();
    }
  });

  const menu = mountMenu(store, actions);
  mountStage(store, audio, { onSoundChange: (on) => pref.set("ascent-sound", on ? "1" : "0") });
  mountData(store, { openFair: (roundId) => menu.openFair(roundId), openPilots: () => menu.openPilots() });
  mountControls(store, actions);

  backend.createRealtime({ onEvent, onStatus: (connection) => store.set({ connection }), onResync: resync }).start();
}

boot();
