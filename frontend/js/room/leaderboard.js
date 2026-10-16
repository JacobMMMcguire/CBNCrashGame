// Leaderboard view. Draws exactly what the server sent in leaderboard.updated
// (or the welcome): rank, name and balance. The page never sorts or ranks;
// it only marks the viewer's own row.

import { formatCredits, t } from "../i18n.js";

/**
 * @param {HTMLOListElement} list
 * @param {{entries: {rank:number, playerId:string, name:string, balance:string}[]}} board
 * @param {{me?: string, limit?: number}} opts  limit keeps the top rows and always adds the viewer's row
 */
export function renderLeaderboard(list, board, { me = null, limit = Infinity } = {}) {
  let rows = board.entries;
  if (rows.length > limit) {
    const top = rows.slice(0, limit);
    const mine = rows.find((e) => e.playerId === me);
    rows = mine && !top.includes(mine) ? [...top.slice(0, limit - 1), mine] : top;
  }
  list.replaceChildren(...rows.map((e) => {
    const li = document.createElement("li");
    li.className = "lb-row";
    if (e.playerId === me) {
      li.dataset.me = "true";
      li.setAttribute("aria-current", "true");
    }
    const rank = document.createElement("span");
    rank.className = "lb-row__rank";
    rank.textContent = e.rank;
    const name = document.createElement("span");
    name.className = "lb-row__name";
    name.textContent = e.playerId === me ? t("room.lb.you", { name: e.name }) : e.name;
    const bal = document.createElement("span");
    bal.className = "lb-row__bal";
    bal.textContent = formatCredits(e.balance);
    li.append(rank, name, bal);
    return li;
  }));
  const panel = list.closest("[data-lb]");
  panel?.toggleAttribute("data-empty", board.entries.length === 0);
  // Which round the balances are from, so a wager in flight does not look like a wrong number.
  const caption = panel?.querySelector("[data-lb-caption]");
  if (caption) {
    const n = board.afterRoundId?.match(/r_(\d+)$/)?.[1];
    caption.textContent = n ? t("room.lb.afterRound", { n }) : t("room.lb.beforeFirst");
  }
}
