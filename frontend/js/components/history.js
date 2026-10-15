// Mission log: past rounds, newest first, with this player's result.

import { formatCredits, formatMultiplier, t } from "../i18n.js";

function entry(round) {
  const li = document.createElement("li");
  li.className = "entry";
  const crash = Object.assign(document.createElement("span"), { className: "entry__crash", textContent: formatMultiplier(round.crash) });
  const you = document.createElement("span");
  const r = round.myResult;
  if (!r) {
    you.className = "entry__you entry__you--none";
    you.textContent = t("log.noBet");
  } else {
    const won = r.status === "cashed-out";
    const profit = Number(r.profit);
    you.className = `entry__you entry__you--${won ? "win" : "loss"}`;
    you.textContent = (profit > 0 ? "+" : profit < 0 ? "−" : "") + formatCredits(Math.abs(profit));
    you.append(Object.assign(document.createElement("span"), { className: "sr-only", textContent: `, ${t(won ? "log.won" : "log.lost")}` }));
  }
  li.append(crash, you);
  return li;
}

export function mountHistory(store) {
  const list = document.getElementById("log");
  let last = null;
  store.subscribe((s) => {
    const key = s.history.map((h) => h.roundId).join() + s.lang;
    if (key === last) return;
    last = key;
    if (s.history.length === 0) {
      list.replaceChildren(Object.assign(document.createElement("li"), { className: "hint", textContent: t("log.empty") }));
    } else {
      list.replaceChildren(...s.history.map(entry));
    }
  });
}
