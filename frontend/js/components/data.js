// Read data: balance, the current position (wager, live multiplier, payout),
// session result and stats, recent crash points, my last flights, and the
// provably-fair chip for the current round.

import { formatCredits, formatMultiplier, formatNumber, formatPercent, t } from "../i18n.js";
import { liveMultiplier, payoutAt } from "../live.js";
import { setText } from "../store.js";

const $ = (id) => document.getElementById(id);

/** Colour tier for a crash point in the history strip. */
const tier = (crash) => (crash >= 10 ? "high" : crash >= 2 ? "mid" : "low");
const roundNo = (id) => String(id).replace(/^r_/, "");
const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + formatCredits(Math.abs(n));
const shortHash = (h) => (h ? `${h.slice(0, 8)}…${h.slice(-6)}` : "");

/** A stable colour per player, from their public id. */
export function playerColor(playerId) {
  let h = 0;
  for (const ch of String(playerId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 75% 68%)`;
}

/** One roster row: colour dot, name, wager, result. Shared with the Pilots sheet. */
export function rosterRow(p, meId) {
  const li = Object.assign(document.createElement("li"), { className: "roster__row" + (p.playerId === meId ? " is-me" : "") });
  const dot = Object.assign(document.createElement("span"), { className: "roster__dot" });
  dot.style.background = playerColor(p.playerId);
  const name = Object.assign(document.createElement("span"), {
    className: "roster__name", textContent: p.playerId === meId ? t("players.you", { name: p.name }) : p.name,
  });
  const wager = Object.assign(document.createElement("span"), { className: "roster__wager", textContent: formatCredits(p.wager) });
  const result = Object.assign(document.createElement("span"), { className: "roster__result" });
  if (p.status === "cashed-out") {
    result.classList.add("is-pos");
    result.textContent = `${formatMultiplier(p.multiplier)} ${signed(Number(p.payout) - Number(p.wager))}`;
  } else if (p.status === "lost") {
    result.classList.add("is-neg");
    result.textContent = signed(-Number(p.wager));
  } else {
    result.classList.add("is-riding");
    result.textContent = t("players.riding");
  }
  li.append(dot, name, wager, result);
  return li;
}

export function mountData(store, { openFair, openPilots }) {
  const balance = $("balance"), net = $("net"), rounds = $("rounds"), best = $("best"), wagered = $("wagered");
  const pills = $("pills"), flights = $("flights"), fairChip = $("fairChip"), fairText = $("fairText");

  fairChip.addEventListener("click", () => openFair(null));
  const crowd = $("crowd"), crowdText = $("crowdText"), roster = $("roster"), rosterCount = $("rosterCount");
  crowd.addEventListener("click", () => openPilots());
  // Phone grid and the menu's history section
  const mBalance = $("mBalance"), mCrowd = $("mCrowd"), mCrowdIn = $("mCrowdIn"), mCrowdOf = $("mCrowdOf");
  const sheetPills = $("sheetPills"), sheetNet = $("sheetNet");
  mCrowd.addEventListener("click", () => openPilots());
  let lastRoster = null;
  for (const list of [pills, sheetPills]) {
    list.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-round]");
      if (b) openFair(b.dataset.round);
    });
  }

  mountPosition(store);

  // Phones draw the sky under this panel; the stage's icons and readout sit just below it.
  const panel = document.querySelector(".data");
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--hud-top", `${Math.round(panel.getBoundingClientRect().bottom)}px`);
  }).observe(panel);

  let lastHistory = null;
  store.subscribe((s) => {
    // Multiplayer: who is in this launch and how many are online
    setText(crowdText, `${s.players.length}/${Math.max(s.online, 1)}`);
    crowd.setAttribute("aria-label", t("players.crowdAria", { n: s.players.length, o: Math.max(s.online, 1) }));
    setText(rosterCount, t("players.count", { n: s.players.length, o: Math.max(s.online, 1) }));
    setText(mCrowdIn, String(s.players.length));
    setText(mCrowdOf, t("data.participantsOf", { o: Math.max(s.online, 1) }));
    mCrowd.setAttribute("aria-label", t("players.crowdAria", { n: s.players.length, o: Math.max(s.online, 1) }));
    if (s.players !== lastRoster || s.lang !== roster.dataset.lang) {
      lastRoster = s.players;
      roster.dataset.lang = s.lang;
      roster.replaceChildren(...(s.players.length
        ? s.players.map((p) => rosterRow(p, s.me?.playerId))
        : [Object.assign(document.createElement("li"), { className: "roster__empty", textContent: t("players.empty") })]));
    }

    setText(balance, formatCredits(s.balance));
    setText(mBalance, formatCredits(s.balance));
    const n = s.session.net;
    for (const el of [net, sheetNet]) {
      setText(el, signed(n));
      el.classList.toggle("is-pos", n > 0);
      el.classList.toggle("is-neg", n < 0);
    }
    setText(rounds, formatNumber(s.session.rounds));
    setText(best, s.session.best ? formatMultiplier(s.session.best) : "–");
    setText(wagered, formatCredits(s.session.wagered));
    setText(fairText, s.round.roundId
      ? t("data.fairChip", { id: roundNo(s.round.roundId), rtp: formatPercent(s.config.targetRtp), hash: shortHash(s.round.commitment) })
      : t("fair.none"));

    const key = s.history.map((h) => h.roundId).join() + s.lang;
    if (key === lastHistory) return;
    lastHistory = key;

    const pillItems = () => (s.history.length === 0
      ? [Object.assign(document.createElement("li"), { className: "pills__empty", textContent: t("data.noLaunches") })]
      : s.history.slice(0, 24).map((h) => {
        const li = document.createElement("li");
        const b = Object.assign(document.createElement("button"), { type: "button", className: "pill", textContent: formatMultiplier(h.crash) });
        b.dataset.round = h.roundId;
        b.dataset.tier = tier(h.crash);
        b.setAttribute("aria-label", t("data.pillAria", { id: roundNo(h.roundId), m: formatMultiplier(h.crash) }));
        li.append(b);
        return li;
      }));
    pills.replaceChildren(...pillItems());
    sheetPills.replaceChildren(...pillItems());

    const mine = s.history.filter((h) => h.myResult).slice(0, 8);
    if (mine.length === 0) {
      flights.replaceChildren(Object.assign(document.createElement("li"), { className: "pills__empty", textContent: t("data.noFlights") }));
    } else {
      flights.replaceChildren(...mine.map((h) => {
        const r = h.myResult;
        const won = r.status === "cashed-out";
        const li = Object.assign(document.createElement("li"), { className: "flight" });
        const id = Object.assign(document.createElement("span"), { className: "flight__id", textContent: `#${roundNo(h.roundId)}` });
        const res = Object.assign(document.createElement("span"), {
          className: won ? "is-pos" : "is-neg",
          textContent: won
            ? t("data.flightWon", { m: formatMultiplier(r.multiplier), p: signed(Number(r.profit)) })
            : t("data.flightLost", { c: formatMultiplier(h.crash), p: signed(Number(r.profit)) }),
        });
        li.append(id, res);
        return li;
      }));
    }
  });
}

/**
 * Position: what this player has riding on the current launch. Updated every
 * frame so the multiplier and payout move with the rocket.
 */
function mountPosition(store) {
  const box = $("position");
  const wager = $("posWager"), wagerSub = $("posWagerSub");
  const mult = $("posMult"), multSub = $("posMultSub");
  const payout = $("posPayout"), payoutSub = $("posPayoutSub");
  // Phone grid: Payout is this launch's net result (profit or loss), not the gross amount.
  const mWager = $("mWager"), mPayout = $("mPayout"), mPayoutBox = $("mPayoutBox");

  function render() {
    const s = store.get();
    if (!s.config) return;
    const st = s.round.state;
    const m = liveMultiplier(s);
    const bet = s.round.roundId && s.myBet?.wager !== undefined ? s.myBet : null;
    const auto = bet?.autoCashOut ? t("pos.auto", { a: formatMultiplier(bet.autoCashOut) }) : t("pos.manual");

    setText(mult, formatMultiplier(m));
    setText(multSub, t(`pos.state.${st === "settled" ? "crashed" : st}`));
    box.toggleAttribute("data-hot", st === "in-flight" && m >= 10);

    let state = "none";
    if (!bet) {
      setText(wager, "–");
      setText(wagerSub, s.queued ? t("pos.queued") : t("pos.noBet"));
      setText(payout, "–");
      setText(payoutSub, "");
    } else {
      setText(wager, formatCredits(bet.wager));
      setText(wagerSub, auto);
      if (bet.status === "cashed-out" && bet.payout !== undefined) {
        state = "won";
        setText(payout, formatCredits(bet.payout));
        setText(payoutSub, t("pos.ejectedAt", { m: formatMultiplier(bet.multiplier) }));
      } else if (bet.status === "lost") {
        state = "lost";
        setText(payout, formatCredits(0));
        setText(payoutSub, t("pos.lost"));
      } else if (st === "in-flight") {
        state = "riding";
        setText(payout, formatCredits(payoutAt(bet.wager, m)));
        setText(payoutSub, t("pos.ifNow"));
      } else {
        state = "boarding";
        setText(payout, bet.autoCashOut ? formatCredits(payoutAt(bet.wager, bet.autoCashOut)) : "–");
        setText(payoutSub, bet.autoCashOut ? t("pos.atAuto", { a: formatMultiplier(bet.autoCashOut) }) : t("pos.atLaunch"));
      }
    }
    if (box.dataset.state !== state) box.dataset.state = state;

    const net = !bet ? null
      : state === "won" ? Number(bet.payout) - Number(bet.wager)
      : state === "lost" ? -Number(bet.wager)
      : state === "riding" ? payoutAt(bet.wager, m) - Number(bet.wager)
      : 0;
    setText(mWager, bet ? formatCredits(bet.wager) : "–");
    setText(mPayout, net === null ? "–" : signed(Math.round(net * 100) / 100));
    if (mPayoutBox.dataset.state !== state) mPayoutBox.dataset.state = state;
  }

  (function loop() {
    render();
    requestAnimationFrame(loop);
  })();
}
