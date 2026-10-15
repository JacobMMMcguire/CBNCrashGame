// Stage: phase chip, multiplier readout and the status line.
// The status line is the polite live region: it changes once per game state,
// never per tick, so screen readers hear each state exactly once.

import { formatCredits, formatMultiplier, t } from "../i18n.js";
import { setText, uiPhase } from "../store.js";

function statusText(s, phase) {
  const bet = s.myBet;
  switch (phase) {
    case "boarding":
      if (s.round.state !== "betting") return t("status.idle");
      return bet ? t("status.bettingWithBet", { w: formatCredits(bet.wager) }) : t("status.betting");
    case "flying":
      return bet ? t("status.flying") : t("status.flyingNoBet");
    case "ejected":
      if (bet.multiplier === undefined || bet.wager === undefined) return t("status.ejectedShort");
      return t("status.ejected", {
        m: formatMultiplier(bet.multiplier),
        p: formatCredits(Number(bet.payout) - Number(bet.wager)),
      });
    case "aborted": {
      const c = formatMultiplier(s.round.crash ?? s.multiplier);
      return bet ? t("status.aborted", { c, w: formatCredits(bet.wager) }) : t("status.abortedNoBet", { c });
    }
  }
  return "";
}

function readoutValue(s, phase) {
  if (phase === "boarding") return 1;
  if (phase === "ejected" && s.myBet.multiplier !== undefined) return s.myBet.multiplier;
  if (phase === "aborted") return s.round.crash ?? s.multiplier;
  return s.multiplier;
}

export function mountStage(store) {
  const phaseEl = document.getElementById("phase");
  const mult = document.getElementById("mult");
  const status = document.getElementById("status");
  const number = document.createTextNode("");
  const x = document.createElement("span");
  x.className = "mult__x";
  x.textContent = "×";
  mult.replaceChildren(number, x);

  store.subscribe((s) => {
    const phase = uiPhase(s);
    document.body.dataset.phase = phase;
    setText(phaseEl, t(`phase.${phase}`));
    const text = formatMultiplier(readoutValue(s, phase)).slice(0, -1);
    if (number.data !== text) number.data = text;
    setText(status, statusText(s, phase));
  });
}
