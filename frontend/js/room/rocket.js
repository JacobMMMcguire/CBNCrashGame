// The launch scene for room pages: the same rocket, sky and explosion as the
// main game, driven only by the room's own server events. Shared by the host
// screen and (later) the phone page: call mountRocket(stageEl) once, pass
// every room message to handle(), and the scene animates itself.
//
// Like the main game, the multiplier between server ticks follows the
// contract curve m(t) = e^(growthRate * t) from the server's launch time, never
// more than a quarter second ahead of the last tick. The crash point only ever
// comes from the server.

import { createScene } from "../scene/scene.js";

const scenePhase = (state) => (state === "in-flight" ? "flight" : state === "crashed" || state === "settled" ? "crash" : "pad");

export function mountRocket(stage) {
  const canvas = Object.assign(document.createElement("canvas"), { className: "rocket-sky" });
  canvas.setAttribute("aria-hidden", "true");
  stage.prepend(canvas);
  // The scene adds its name-tag layer next to the canvas; keep both behind the stage text.
  const scene = createScene(canvas, { reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches });

  const fit = () => scene.resize(stage.clientWidth, stage.clientHeight);
  new ResizeObserver(fit).observe(stage);
  fit();

  const s = { state: "idle", launchedAt: null, growth: 0.06, tick: 1, crash: null, offsetMs: 0, roundId: null, ejected: new Set() };
  const now = () => Date.now() + s.offsetMs;

  function handle(msg) {
    const d = msg.data || {};
    switch (msg.type) {
      case "welcome":
        if (d.serverTime) s.offsetMs = Date.parse(d.serverTime) - Date.now();
        s.state = d.round?.state || "idle";
        s.roundId = d.round?.roundId || null;
        s.crash = d.round?.crash ?? null;
        s.launchedAt = d.round?.launchedAt ? Date.parse(d.round.launchedAt) : null;
        s.tick = d.round?.multiplier ?? 1;
        break;
      case "round.betting":
        Object.assign(s, { state: "betting", roundId: msg.roundId, launchedAt: null, tick: 1, crash: null });
        s.ejected.clear();
        break;
      case "round.launched":
        Object.assign(s, { state: "in-flight", launchedAt: Date.parse(d.launchedAt), growth: d.growthRate ?? s.growth, tick: 1 });
        break;
      case "round.tick":
        s.tick = d.multiplier;
        if (s.state !== "in-flight") s.state = "in-flight";
        if (!s.launchedAt && d.elapsedMs !== undefined) s.launchedAt = now() - d.elapsedMs;
        break;
      case "round.crashed":
        Object.assign(s, { state: "crashed", crash: d.crash });
        break;
      case "round.settled":
        s.state = "settled";
        break;
      case "round.players":
        // An astronaut with a name tag leaves the rocket for each pilot who cashes out.
        if (s.state !== "in-flight") break;
        for (const p of d.players || []) {
          if (p.status === "cashed-out" && !s.ejected.has(p.playerId)) {
            s.ejected.add(p.playerId);
            scene.eject({ mine: false, name: p.name });
          }
        }
        break;
    }
  }

  function multiplier() {
    if (s.state === "crashed" || s.state === "settled") return s.crash ?? s.tick;
    if (s.state !== "in-flight" || !s.launchedAt) return 1;
    const elapsed = Math.max(0, (now() - s.launchedAt) / 1000);
    const ceiling = Math.max(1, s.tick) * Math.exp(s.growth * 0.25);
    return Math.max(s.tick, Math.floor(Math.min(Math.exp(s.growth * elapsed), ceiling) * 100) / 100);
  }

  let last = performance.now();
  (function loop(t) {
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    const elapsedMs = s.state === "in-flight" && s.launchedAt ? now() - s.launchedAt : 0;
    scene.frame({ phase: scenePhase(s.state), m: multiplier(), elapsedMs }, dt);
    requestAnimationFrame(loop);
  })(last);

  return { handle, multiplier };
}
