// Stage: drives the canvas scene, the readout over it and the sound effects
// every animation frame. The live multiplier comes from live.js.
//
// The status line (#status) is the polite live region: it changes once per
// game state, never per frame, so screen readers hear each state once.

import { createScene } from "../scene/scene.js";
import { formatCredits, formatMultiplier, formatSeconds, t } from "../i18n.js";
import { liveMultiplier, payoutAt, secondsLeft } from "../live.js";
import { setText, uiPhase } from "../store.js";

const $ = (id) => document.getElementById(id);

function scenePhase(state) {
  if (state === "in-flight") return "flight";
  if (state === "crashed" || state === "settled") return "crash";
  return "pad";
}

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
      return t("status.ejected", { m: formatMultiplier(bet.multiplier), p: formatCredits(Number(bet.payout) - Number(bet.wager)) });
    case "aborted": {
      const c = formatMultiplier(s.round.crash ?? s.multiplier);
      return bet ? t("status.aborted", { c, w: formatCredits(bet.wager) }) : t("status.abortedNoBet", { c });
    }
  }
  return "";
}

export function mountStage(store, audio, { onSoundChange }) {
  const canvas = $("sky");
  const stage = canvas.parentElement;
  const label = $("readLabel"), mult = $("mult"), note = $("readNote"), status = $("status");
  const readout = mult.parentElement;
  const bar = $("countdown").firstElementChild;
  const toasts = $("toasts");
  const conn = $("conn"), connText = $("connText");

  // A flyby takes over the readout label for a few seconds ("10× · Moon flyby").
  let flyby = null;
  const scene = createScene(canvas, {
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    onMilestone(ms) {
      flyby = { ms, until: performance.now() + 3000 };
      audio.play("flyby");
    },
  });

  const soundBtn = $("soundBtn");
  soundBtn.setAttribute("aria-pressed", String(audio.enabled));
  soundBtn.addEventListener("click", () => {
    audio.setEnabled(!audio.enabled);
    soundBtn.setAttribute("aria-pressed", String(audio.enabled));
    onSoundChange(audio.enabled);
  });
  new ResizeObserver(([entry]) => scene.resize(entry.contentRect.width, entry.contentRect.height)).observe(stage);
  scene.resize(stage.clientWidth, stage.clientHeight);

  function toast(text, kind = "") {
    const el = Object.assign(document.createElement("p"), { className: `toast ${kind ? "toast--" + kind : ""}`, textContent: text });
    el.setAttribute("role", kind === "error" ? "alert" : "status");
    toasts.append(el);
    while (toasts.children.length > 2) toasts.firstElementChild.remove();
    setTimeout(() => el.remove(), 3300);
  }

  // ---------- Once per store change: state-level text, toasts, scene events ----------
  store.subscribe((s, prev) => {
    const phase = uiPhase(s);
    document.body.dataset.phase = phase;
    setText(status, statusText(s, phase));
    conn.dataset.status = s.connection;
    setText(connText, t(`conn.${s.connection}`));
    if (!prev) return;

    // Sound cues for state changes within the same round
    const same = prev.round.roundId === s.round.roundId;
    const was = prev.round.state, now = s.round.state;
    if (same && was === "betting" && (now === "in-flight" || now === "crashed")) audio.play("ignition");
    if (same && (now === "crashed" || now === "settled") && (was === "in-flight" || was === "betting")) audio.crash();
    if (same && !prev.myBet?.wager && s.myBet?.wager) audio.play("bet");
    if (s.error && s.error !== prev.error) audio.play("error");

    const wasActive = prev.myBet?.status === "active" && prev.round.roundId === s.round.roundId;
    if (wasActive && s.myBet?.status === "cashed-out") {
      scene.eject();
      audio.play("cashout");
      const profit = formatCredits(Number(s.myBet.payout) - Number(s.myBet.wager));
      toast(t(s.myBet.auto ? "toast.autoEjected" : "toast.ejected", { p: profit, m: formatMultiplier(s.myBet.multiplier) }), "win");
    }
    if (s.error && s.error !== prev.error) toast(t(`errors.${s.error}`), "error");
    if (s.notice && s.notice !== prev.notice) toast(s.notice.text);
  });

  // ---------- Every frame: scene, live multiplier, countdown ----------
  let last = performance.now();
  let lastTick = null;
  function loop(now) {
    const dt = (now - last) / 1000;
    last = now;
    const s = store.get();
    if (s.config) {
      const m = liveMultiplier(s);
      const phase = uiPhase(s);
      const st = s.round.state;
      const elapsedMs = s.round.launchedAt ? Date.now() + s.clockOffsetMs - Date.parse(s.round.launchedAt) : 0;
      scene.frame({ phase: scenePhase(st), m, elapsedMs }, dt);
      audio.engine(st === "in-flight", scene.speedFraction());
      renderReadout(s, phase, st, m);
      // Countdown ticks for the last three seconds of boarding
      const whole = st === "betting" ? Math.ceil(secondsLeft(s)) : null;
      if (whole !== lastTick && whole !== null && whole >= 1 && whole <= 3 && lastTick !== null) {
        audio.play("tick", { rate: whole === 1 ? 1.3 : 1 });
      }
      lastTick = whole;
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  function renderReadout(s, phase, st, m) {
    const bet = s.myBet;
    if (st === "betting") {
      const left = secondsLeft(s);
      setText(label, t("read.launchIn"));
      setText(mult, formatSeconds(left));
      bar.style.transform = `scaleX(${Math.min(1, left / (s.config.bettingWindowMs / 1000))})`;
    } else if (st === "in-flight") {
      const showFlyby = flyby && performance.now() < flyby.until;
      setText(label, showFlyby ? t("milestone", { m: flyby.ms.at, body: t(`body.${flyby.ms.key}`) }) : t("read.multiplier"));
      label.toggleAttribute("data-flash", showFlyby);
      setText(mult, formatMultiplier(m));
    } else if (st === "crashed" || st === "settled") {
      setText(label, t("read.crashed"));
      setText(mult, formatMultiplier(m));
    } else {
      setText(label, t("read.preparing"));
      setText(mult, formatMultiplier(1));
    }
    if (st !== "in-flight") { flyby = null; label.removeAttribute("data-flash"); }
    readout.toggleAttribute("data-hot", st === "in-flight" && m >= 10);

    let text = "", tone = "";
    if (phase === "boarding") {
      if (bet) text = t("note.onBoard", { w: formatCredits(bet.wager) });
      else if (s.queued) text = t("note.queued");
    } else if (phase === "flying" && bet?.status === "active") {
      text = t("note.riding", { w: formatCredits(bet.wager), v: formatCredits(payoutAt(bet.wager, m)) });
    } else if (phase === "ejected" && bet?.multiplier !== undefined) {
      text = t("note.ejected", { m: formatMultiplier(bet.multiplier), p: formatCredits(Number(bet.payout) - Number(bet.wager)) });
      tone = "win";
    } else if (phase === "aborted" && bet?.wager !== undefined) {
      text = t("note.lost", { w: formatCredits(bet.wager) });
      tone = "loss";
    }
    setText(note, text);
    if (note.dataset.tone !== tone) note.dataset.tone = tone;
  }
}
