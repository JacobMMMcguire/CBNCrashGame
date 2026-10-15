// Mission control dialog (language, how to play, odds, provably fair, responsible
// play) and the reality-check reminder. Everything that is not needed every
// second lives here, so the game screen stays uncluttered.

import { applyI18n, formatCredits, formatMultiplier, formatNumber, formatPercent, t } from "../i18n.js";
import { setText } from "../store.js";
import { rosterRow } from "./data.js";

const $ = (id) => document.getElementById(id);
const ODDS_TARGETS = [1.5, 2, 3, 5, 10, 100, 1000];
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

export function mountMenu(store, actions) {
  const dialog = $("menu"), reality = $("reality");
  const langSwitch = $("langSwitch"), fairCommit = $("fairCommit"), verify = $("verify");
  const odds = $("odds"), oddsNote = $("oddsNote"), realityNote = $("realityNote");

  for (const d of [dialog, reality]) {
    d.addEventListener("click", (e) => {
      if (e.target === d || e.target.closest("[data-close]")) d.close();
    });
  }
  $("menuBtn").addEventListener("click", () => dialog.showModal());

  const cfg = store.get().config;
  langSwitch.replaceChildren(...cfg.supportedLanguages.map((code) => {
    const b = el("button", { type: "button", textContent: code.toUpperCase(), lang: code, title: t(`lang.${code}`) });
    b.dataset.lang = code;
    b.addEventListener("click", () => actions.setLanguage(code));
    return b;
  }));

  function renderOdds(s) {
    const c = s.config;
    oddsNote.textContent = t("odds.note", {
      rtp: formatPercent(c.targetRtp), edge: formatPercent(1 - c.targetRtp),
      instant: formatPercent(1 - c.targetRtp / 1.01), max: formatMultiplier(c.maxMultiplier),
    });
    const sample = c.quickBetChips[0];
    const head = el("tr", {}, el("th", { textContent: t("odds.target") }), el("th", { textContent: t("odds.chance") }),
      el("th", { textContent: t("odds.pays", { w: formatCredits(sample) }) }));
    const rows = ODDS_TARGETS.filter((m) => m <= c.maxMultiplier).map((m) => el("tr", {},
      el("td", { textContent: formatMultiplier(m) }),
      el("td", { textContent: formatPercent(c.targetRtp / m) }),
      el("td", { textContent: formatCredits(Number(sample) * m) })));
    odds.replaceChildren(el("thead", {}, head), el("tbody", {}, ...rows));
    const n = c.realityCheckMinutes;
    realityNote.textContent = n > 0 ? t("play.reality", { n }) : "";
    const seconds = (m) => formatNumber(Math.round((Math.log(m) / c.growthRate) * 10) / 10);
    $("txRtp").textContent = t("tx.rtp", {
      rtp: formatPercent(c.targetRtp), edge: formatPercent(1 - c.targetRtp), instant: formatPercent(1 - c.targetRtp / 1.01),
    });
    $("txCurve").textContent = t("tx.curve", { k: formatNumber(c.growthRate), d: seconds(2), t10: seconds(10), t100: seconds(100), max: formatMultiplier(c.maxMultiplier) });
  }

  function renderVerify(v) {
    if (!v) return verify.replaceChildren();
    const id = String(v.roundId).replace(/^r_/, "");
    if (v.status === "loading") return verify.replaceChildren(el("p", { className: "muted", textContent: t("fair.checking", { id }) }));
    if (v.status === "error") return verify.replaceChildren(el("p", { className: "bad", textContent: t(`errors.${v.code}`) }));
    const { data, check } = v;
    const allOk = check.commitmentOk && check.crashOk;
    const line = (ok, text) => el("li", { className: ok ? "ok" : "bad", textContent: `${ok ? "✓" : "✗"} ${text}` });
    verify.replaceChildren(
      el("p", { className: "verify__title" },
        el("span", { textContent: t("fair.round", { id, c: formatMultiplier(data.crash) }) }),
        el("span", { className: allOk ? "ok" : "bad", textContent: allOk ? t("fair.verified") : t("fair.failed") })),
      el("dl", { className: "kv" },
        el("div", {}, el("dt", { textContent: t("fair.seed") }), el("dd", { className: "hash", textContent: data.serverSeed })),
        el("div", {}, el("dt", { textContent: t("fair.commit") }), el("dd", { className: "hash", textContent: data.commitment })),
        el("div", {}, el("dt", { textContent: "HMAC-SHA256(seed, " + data.roundId + ")" }), el("dd", { className: "hash", textContent: check.hmac }))),
      el("ul", { className: "verify__checks" },
        line(check.commitmentOk, t("fair.checkCommit")),
        line(check.crashOk, t("fair.checkCrash", { c: formatMultiplier(check.computed) })),
        line(data.valid, t("fair.checkServer"))),
      store.get().mode === "mock" ? el("p", { className: "muted", textContent: t("fair.mock") }) : "",
    );
  }

  // ---------- Pilots: your name and everyone in this launch ----------
  const nameForm = $("nameForm"), nameInput = $("pilotName"), nameHint = $("nameHint");
  const sheetRoster = $("sheetRoster"), sheetCount = $("sheetRosterCount");
  nameForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    nameHint.classList.remove("is-error");
    try {
      await actions.setName(nameInput.value);
      nameHint.textContent = t("players.saved");
    } catch (err) {
      nameHint.classList.add("is-error");
      nameHint.textContent = t("players.nameError");
    }
  });
  let lastMe = null, lastCrew = null;

  let lastLang = null, lastVerify = null;
  store.subscribe((s) => {
    langSwitch.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === s.lang)));
    setText(fairCommit, s.round.commitment || t("fair.none"));
    if (s.lang !== lastLang) {
      lastLang = s.lang;
      applyI18n(dialog);
      renderOdds(s);
      lastVerify = null;
    }
    if (s.me && s.me !== lastMe) {
      lastMe = s.me;
      if (document.activeElement !== nameInput) nameInput.value = s.me.name;
    }
    setText(sheetCount, t("players.count", { n: s.players.length, o: Math.max(s.online, 1) }));
    if (s.players !== lastCrew || s.lang !== sheetRoster.dataset.lang) {
      lastCrew = s.players;
      sheetRoster.dataset.lang = s.lang;
      sheetRoster.replaceChildren(...(s.players.length
        ? s.players.map((p) => rosterRow(p, s.me?.playerId))
        : [Object.assign(document.createElement("li"), { className: "roster__empty", textContent: t("players.empty") })]));
    }
    if (s.verify !== lastVerify) {
      lastVerify = s.verify;
      renderVerify(s.verify);
    }
  });

  // ---------- Reality check (responsible play) ----------
  const minutes = cfg.realityCheckMinutes;
  if (minutes > 0) {
    let shown = 0;
    setInterval(() => {
      const s = store.get();
      const played = Math.floor((Date.now() - s.session.startedAt) / 60000);
      if (played < (shown + 1) * minutes) return;
      shown = Math.floor(played / minutes);
      const net = s.session.net;
      setText($("realityText"), t("reality.body", {
        n: played, r: s.session.rounds,
        net: (net > 0 ? "+" : net < 0 ? "−" : "") + formatCredits(Math.abs(net)),
      }));
      if (!reality.open) reality.showModal();
    }, 15000);
  }

  return {
    /** Open the dialog at the Pilots section (name and roster). */
    openPilots() {
      if (!dialog.open) dialog.showModal();
      dialog.querySelector(".sheet__body").scrollTop = $("pilotsSec").offsetTop - 6;
    },
    /** Open the dialog at the provably fair section and check a round (default: the latest finished one). */
    openFair(roundId) {
      const s = store.get();
      const id = roundId ?? s.history[0]?.roundId;
      if (!dialog.open) dialog.showModal();
      const body = dialog.querySelector(".sheet__body");
      body.scrollTop = $("fairSec").offsetTop - 6;  // not scrollIntoView: it would also scroll the dialog box itself
      if (id) actions.verify(id);
    },
  };
}
