// Controls: wager, quick-bet chips, auto eject, Place bet and Eject.
// Button rules (DESIGN.md "Buttons"):
//   Place bet is enabled only while betting is open, with no bet yet and a valid wager.
//   Eject is enabled only in flight while this player's bet is active.

import { formatCredits, formatMultiplier, formatNumber, parseCreditsInput, parseMultiplierInput, t } from "../i18n.js";
import { setText, uiPhase } from "../store.js";

const toUnits = (credits) => Math.round(Number(credits) * 100);
const fromUnits = (u) => (u / 100).toFixed(2);

function evaluate(s) {
  const cfg = s.config;
  const wager = parseCreditsInput(s.wagerText);
  const wagerOk = wager !== null && toUnits(wager) >= toUnits(cfg.minBet) && toUnits(wager) <= toUnits(cfg.maxBet);
  const autoEmpty = s.autoText.trim() === "";
  const auto = autoEmpty ? null : parseMultiplierInput(s.autoText);
  const autoOk = autoEmpty || (auto !== null && auto >= cfg.autoCashOutMin && auto <= cfg.maxMultiplier);
  return { wager, wagerOk, auto, autoOk };
}

function secondsLeft(s) {
  if (s.round.state !== "betting" || !s.round.closesAt) return 0;
  const serverNow = Date.now() + s.clockOffsetMs;
  const left = Math.ceil((Date.parse(s.round.closesAt) - serverNow) / 1000);
  return Math.min(Math.max(0, left), Math.ceil(s.config.bettingWindowMs / 1000));
}

function setButton(btn, main, sub, tone) {
  const key = `${main}|${sub}|${tone}`;
  if (btn.dataset.key === key) return;
  btn.dataset.key = key;
  btn.classList.toggle("is-win", tone === "win");
  btn.classList.toggle("is-abort", tone === "abort");
  const parts = [Object.assign(document.createElement("span"), { textContent: main })];
  if (sub) parts.push(Object.assign(document.createElement("span"), { className: "btn__sub", textContent: sub }));
  btn.replaceChildren(...parts);
}

export function mountControls(store, actions) {
  const $ = (id) => document.getElementById(id);
  const section = $("controls"), form = $("betForm"), wager = $("wager"), auto = $("auto");
  const chips = $("chips"), betBtn = $("betBtn"), ejectBtn = $("ejectBtn");
  const betWhy = $("betWhy"), ejectWhy = $("ejectWhy"), error = $("error"), win = $("window");
  const wagerHint = $("wagerHint"), roundLabel = $("roundLabel");

  wager.value = store.get().wagerText;
  wager.addEventListener("input", () => store.set({ wagerText: wager.value, error: null }));
  auto.addEventListener("input", () => store.set({ autoText: auto.value, error: null }));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!betBtn.disabled) actions.placeBet();
  });
  ejectBtn.addEventListener("click", () => actions.cashOut());

  // Space ejects during flight when focus is not in a control that uses Space itself.
  document.addEventListener("keydown", (e) => {
    if (e.key !== " " || e.repeat || ejectBtn.disabled) return;
    if (e.target.closest?.("input, textarea, select, button, a, [contenteditable]")) return;
    e.preventDefault();
    actions.cashOut();
  });

  function setWager(credits) {
    wager.value = credits;
    store.set({ wagerText: credits, error: null });
  }

  function buildChips(cfg) {
    const buttons = cfg.quickBetChips.map((c) => {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "chip", textContent: formatNumber(c) });
      b.dataset.value = c;
      b.addEventListener("click", () => setWager(c));
      return b;
    });
    const scale = (key, label, fn) => {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "chip", textContent: label });
      b.dataset.i18nAttr = `aria-label:${key}`;
      b.setAttribute("aria-label", t(key));
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => {
        const s = store.get();
        const current = parseCreditsInput(s.wagerText) ?? s.config.minBet;
        const u = Math.min(toUnits(s.config.maxBet), Math.max(toUnits(s.config.minBet), fn(toUnits(current))));
        setWager(fromUnits(u));
      });
      return b;
    };
    buttons.push(scale("controls.half", "½", (u) => Math.floor(u / 2)), scale("controls.double", "2×", (u) => u * 2));
    chips.replaceChildren(...buttons);
  }
  buildChips(store.get().config);

  function render(s) {
    const cfg = s.config;
    const st = s.round.state;
    const bet = s.myBet;
    const phase = uiPhase(s);
    const online = s.connection === "open" || s.connection === "mock";
    const { wager: w, wagerOk, autoOk } = evaluate(s);
    const left = secondsLeft(s);

    setText(roundLabel, s.round.roundId ? t("controls.round", { id: s.round.roundId.replace(/^r_/, "") }) : "");
    setText(wagerHint, t("controls.wagerHint", { min: formatCredits(cfg.minBet), max: formatCredits(cfg.maxBet) }));
    auto.placeholder = t("controls.autoPlaceholder");
    wager.setAttribute("aria-invalid", String(s.wagerText.trim() !== "" && !wagerOk));
    auto.setAttribute("aria-invalid", String(!autoOk));

    // Inputs lock once a bet is placed for this round (DESIGN.md: locked while riding).
    const locked = Boolean(bet) || s.pending === "bet";
    wager.disabled = locked;
    auto.disabled = locked;
    chips.querySelectorAll(".chip").forEach((c) => {
      c.disabled = locked;
      if (c.dataset.value) c.setAttribute("aria-pressed", String(c.dataset.value === w));
    });

    win.hidden = st !== "betting" || Boolean(bet);
    setText(win, t("controls.window", { s: left }));

    // Place bet
    const canBet = st === "betting" && left > 0 && !bet && online && !s.pending && wagerOk && autoOk;
    betBtn.disabled = !canBet;
    if (s.pending === "bet") setButton(betBtn, t("btn.sending"), "", "");
    else if (bet?.status === "active") setButton(betBtn, t("btn.betPlaced"), t("btn.betPlacedSub", { w: formatCredits(bet.wager) }), "");
    else if (!bet && (st === "betting" || st === "idle")) setButton(betBtn, t("btn.placeBet"), t("btn.placeSub", { w: wagerOk ? formatCredits(w) : "–" }), "");
    else setButton(betBtn, t("btn.nextLaunch"), "", "");
    setText(betWhy, canBet ? "" :
      !online ? t("why.offline") :
      bet ? t("why.betPlaced") :
      st !== "betting" || left === 0 ? t("why.betLocked") :
      !wagerOk ? t("why.wagerInvalid", { min: formatCredits(cfg.minBet), max: formatCredits(cfg.maxBet) }) :
      !autoOk ? t("why.autoInvalid", { min: formatMultiplier(cfg.autoCashOutMin), max: formatMultiplier(cfg.maxMultiplier) }) : "");

    // Eject
    const canEject = st === "in-flight" && bet?.status === "active" && online && s.pending !== "cashout";
    ejectBtn.disabled = !canEject;
    if (s.pending === "cashout") setButton(ejectBtn, t("btn.sending"), "", "");
    else if (canEject) {
      // Live estimate for the label only; the server decides the real payout (§5).
      const estimate = Math.floor((toUnits(bet.wager) * Math.round(s.multiplier * 100)) / 100);
      setButton(ejectBtn, t("btn.eject"), t("btn.ejectSub", { v: formatCredits(fromUnits(estimate)) }), "");
    } else if (phase === "ejected") setButton(ejectBtn, bet.multiplier !== undefined ? t("btn.ejectedAt", { m: formatMultiplier(bet.multiplier) }) : t("phase.ejected"), "", "win");
    else if (phase === "aborted") setButton(ejectBtn, t("btn.aborted"), "", "abort");
    else setButton(ejectBtn, t("btn.eject"), t("btn.ejectIdleSub"), "");
    setText(ejectWhy, canEject ? "" :
      st === "crashed" || st === "settled" ? t("why.done") :
      bet?.status === "cashed-out" ? t("why.ejected") :
      st === "in-flight" && !bet ? t("why.ejectNoBet") : t("why.ejectIdle"));

    setText(error, s.error ? t(`errors.${s.error}`) : "");

    // A button that disables under keyboard focus would drop focus to <body>;
    // keep it inside the controls panel instead.
    const active = document.activeElement;
    if ((active === betBtn || active === ejectBtn) && active.disabled) section.focus();
  }

  let lastLang = null;
  store.subscribe((s) => {
    if (s.lang !== lastLang) {
      lastLang = s.lang;
      buildChips(s.config);
      betBtn.dataset.key = "";
      ejectBtn.dataset.key = "";
    }
    render(s);
  });
  // The countdown moves without events; refresh it a few times a second.
  setInterval(() => { if (store.get().round.state === "betting") render(store.get()); }, 250);
}
