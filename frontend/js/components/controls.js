// Controls: wager stepper, quick chips, auto eject, and one action button whose
// job follows the round (the usual crash-game pattern):
//
//   bet      boarding is open and you have no bet        -> Place bet
//   waiting  your bet is on board                         -> (disabled) waiting for launch
//   eject    in flight with an active bet                 -> Eject, labelled with the live payout
//   queue    in flight / after the crash, no active bet   -> Bet next launch (placed when boarding opens)
//   cancel   a bet is queued for the next launch          -> Cancel it
//   refill   balance below the minimum bet, nothing riding -> Refill play credits
//
// The server validates every bet again; the checks here only explain why the
// button is disabled.

import { formatCredits, formatMultiplier, formatNumber, parseCreditsInput, parseMultiplierInput, t } from "../i18n.js";
import { setText } from "../store.js";

const $ = (id) => document.getElementById(id);
const toUnits = (credits) => Math.round(Number(credits) * 100);
const fromUnits = (u) => (u / 100).toFixed(2);

/** The +/- step for a wager: finer steps at small amounts. */
function stepFor(units, dir) {
  const w = (units - (dir < 0 ? 1 : 0)) / 100;
  return (w < 10 ? 1 : w < 100 ? 5 : w < 500 ? 25 : 100) * 100;
}

/** The +/- step for an auto-eject target, in hundredths: 0.10 near 1×, coarser higher up. */
function autoStepFor(hundredths, dir) {
  const m = (hundredths - (dir < 0 ? 1 : 0)) / 100;
  return m < 2 ? 10 : m < 5 ? 25 : m < 10 ? 50 : m < 50 ? 100 : 1000;
}

function evaluate(s) {
  const cfg = s.config;
  const wager = parseCreditsInput(s.wagerText);
  const u = wager === null ? null : toUnits(wager);
  const wagerOk = u !== null && u >= toUnits(cfg.minBet) && u <= toUnits(cfg.maxBet);
  const affordable = wagerOk && (s.balance === null || u <= toUnits(s.balance));
  const auto = s.autoOn ? parseMultiplierInput(s.autoText) : null;
  const autoOk = !s.autoOn || (auto !== null && auto >= cfg.autoCashOutMin && auto <= cfg.maxMultiplier);
  return { wager, wagerOk, affordable, auto, autoOk };
}

function modeOf(s) {
  const st = s.round.state, bet = s.myBet;
  if (s.connection !== "open" && s.connection !== "mock") return "offline";
  if (s.pending) return "sending";
  if (st === "in-flight" && bet?.status === "active") return "eject";
  if (st === "betting" && bet) return "waiting";
  if (s.balance !== null && toUnits(s.balance) < toUnits(s.config.minBet)) return "refill";
  if (st === "betting" && Date.parse(s.round.closesAt) > Date.now() + s.clockOffsetMs) return "bet";
  return s.queued ? "cancel" : "queue";
}

export function mountControls(store, actions) {
  const section = $("controls"), form = $("betForm"), wager = $("wager"), auto = $("auto"), autoOn = $("autoOn");
  const minus = $("minus"), plus = $("plus"), chips = $("chips"), error = $("error");
  const btn = $("actionBtn"), main = $("actionMain"), sub = $("actionSub");

  const init = store.get();
  wager.value = init.wagerText;
  auto.value = init.autoText;
  autoOn.checked = init.autoOn;

  wager.addEventListener("input", () => actions.setWager(wager.value));
  wager.addEventListener("blur", () => {
    const v = parseCreditsInput(wager.value);
    if (v !== null) { wager.value = v; actions.setWager(v); }
  });
  auto.addEventListener("input", () => actions.setAuto({ autoText: auto.value }));
  auto.addEventListener("blur", () => {
    const v = parseMultiplierInput(auto.value);
    if (v !== null) { auto.value = v.toFixed(2); actions.setAuto({ autoText: auto.value }); }
  });
  autoOn.addEventListener("change", () => actions.setAuto({ autoOn: autoOn.checked }));

  function setWager(credits) {
    wager.value = credits;
    actions.setWager(credits);
  }
  function nudge(dir) {
    const s = store.get();
    const cur = toUnits(parseCreditsInput(s.wagerText) ?? s.config.minBet);
    const next = cur + dir * stepFor(cur, dir);
    setWager(fromUnits(Math.min(toUnits(s.config.maxBet), Math.max(toUnits(s.config.minBet), next))));
  }
  minus.addEventListener("click", () => nudge(-1));
  plus.addEventListener("click", () => nudge(1));

  const autoMinus = $("autoMinus"), autoPlus = $("autoPlus");
  function nudgeAuto(dir) {
    const s = store.get(), cfg = s.config;
    const lo = Math.round(cfg.autoCashOutMin * 100), hi = Math.round(cfg.maxMultiplier * 100);
    const cur = Math.round((parseMultiplierInput(s.autoText) ?? cfg.autoCashOutMin) * 100);
    const step = autoStepFor(cur, dir);
    // Snap to the step grid so 2.37 + 0.25 lands on 2.50, not 2.62.
    const next = dir > 0 ? Math.floor(cur / step) * step + step : Math.ceil(cur / step) * step - step;
    auto.value = (Math.min(hi, Math.max(lo, next)) / 100).toFixed(2);
    actions.setAuto({ autoText: auto.value });
  }
  autoMinus.addEventListener("click", () => nudgeAuto(-1));
  autoPlus.addEventListener("click", () => nudgeAuto(1));

  function act() {
    const s = store.get();
    switch (modeOf(s)) {
      case "bet": return actions.placeBet();
      case "eject": return actions.cashOut();
      case "queue": return actions.setQueued(true);
      case "cancel": return actions.setQueued(false);
      case "refill": return actions.refill();
    }
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!btn.disabled) act();
  });

  // Space ejects during flight when focus is not in a control that uses Space itself.
  document.addEventListener("keydown", (e) => {
    if (e.key !== " " || e.repeat || modeOf(store.get()) !== "eject") return;
    if (e.target.closest?.("input, textarea, select, button, a, [contenteditable], dialog")) return;
    e.preventDefault();
    actions.cashOut();
  });

  function buildChips(cfg) {
    const list = cfg.quickBetChips.map((c) => {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "chip", textContent: formatNumber(c) });
      b.dataset.value = c;
      b.addEventListener("click", () => setWager(c));
      return b;
    });
    const scale = (key, text, fn) => {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "chip", textContent: text });
      b.setAttribute("aria-label", t(key));
      b.addEventListener("click", () => {
        const s = store.get();
        const cur = toUnits(parseCreditsInput(s.wagerText) ?? s.config.minBet);
        setWager(fromUnits(Math.min(toUnits(s.config.maxBet), Math.max(toUnits(s.config.minBet), fn(cur)))));
      });
      return b;
    };
    list.push(scale("controls.half", "½", (u) => Math.floor(u / 2)), scale("controls.double", "2×", (u) => u * 2));
    chips.replaceChildren(...list);
  }

  function render(s) {
    const cfg = s.config;
    const mode = modeOf(s);
    const bet = s.myBet;
    const { wager: w, wagerOk, affordable, autoOk } = evaluate(s);
    const valid = wagerOk && affordable && autoOk;

    // Inputs lock while a bet is on board, queued, or being sent.
    const locked = ["eject", "waiting", "cancel", "sending", "refill"].includes(mode) || Boolean(bet && s.round.state === "betting");
    for (const el of [wager, minus, plus, autoOn]) el.disabled = locked;
    for (const el of [auto, autoMinus, autoPlus]) el.disabled = locked || !s.autoOn;
    form.toggleAttribute("data-auto", s.autoOn); // phones show the target field only while auto eject is on
    chips.querySelectorAll(".chip").forEach((c) => {
      c.disabled = locked;
      if (c.dataset.value) c.setAttribute("aria-pressed", String(c.dataset.value === w));
    });
    wager.setAttribute("aria-invalid", String(!wagerOk));
    auto.setAttribute("aria-invalid", String(s.autoOn && !autoOk));
    wager.title = t("controls.wagerHint", { min: formatCredits(cfg.minBet), max: formatCredits(cfg.maxBet) });

    setText(error, locked ? "" :
      !wagerOk ? t("why.wagerInvalid", { min: formatCredits(cfg.minBet), max: formatCredits(cfg.maxBet) }) :
      !affordable ? t("why.balance") :
      !autoOk ? t("why.autoInvalid", { min: formatMultiplier(cfg.autoCashOutMin), max: formatMultiplier(cfg.maxMultiplier) }) : "");

    const autoSuffix = s.autoOn && autoOk ? t("btn.autoSuffix", { a: formatMultiplier(parseMultiplierInput(s.autoText)) }) : "";
    let m = "", sb = "", disabled = false;
    switch (mode) {
      case "offline": m = t("btn.offline"); disabled = true; break;
      case "sending": m = t("btn.sending"); disabled = true; break;
      case "eject": {
        const est = Math.floor(toUnits(bet.wager) * Math.round(s.multiplier * 100) / 100);
        m = t("btn.eject");
        sb = t("btn.ejectSub", { v: formatCredits(fromUnits(est)) });
        break;
      }
      case "waiting":
        m = t("btn.waiting");
        sb = t("btn.waitingSub", { w: formatCredits(bet.wager) }) +
          (bet.autoCashOut ? t("btn.autoSuffix", { a: formatMultiplier(bet.autoCashOut) }) : "");
        disabled = true;
        break;
      case "bet":
        m = t("btn.placeBet");
        sb = (wagerOk ? t("btn.placeSub", { w: formatCredits(w) }) : "") + autoSuffix;
        disabled = !valid;
        break;
      case "queue":
        m = t("btn.queue");
        sb = (wagerOk ? t("btn.placeSub", { w: formatCredits(w) }) : "") + autoSuffix;
        disabled = !valid;
        break;
      case "refill":
        m = t("btn.refill");
        sb = t("btn.refillSub", { b: formatCredits(cfg.startingBalance) });
        break;
      case "cancel":
        m = t("btn.cancel");
        sb = t("btn.cancelSub", { w: wagerOk ? formatCredits(w) : "–" });
        break;
    }
    if (btn.dataset.mode !== mode) btn.dataset.mode = mode;
    btn.disabled = disabled;
    setText(main, m);
    setText(sub, sb);

    // A button that disables under keyboard focus would drop focus to <body>.
    if (document.activeElement === btn && btn.disabled) section.focus();
  }

  let lastLang = null;
  store.subscribe((s) => {
    if (!s.config) return;
    if (s.lang !== lastLang) {
      lastLang = s.lang;
      buildChips(s.config);
    }
    render(s);
  });
  // Boarding closes on the clock, not on an event; re-check a few times a second.
  setInterval(() => { if (store.get().round.state === "betting") render(store.get()); }, 250);
}
