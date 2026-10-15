// Sound effects through Web Audio. The clips are Kenney's "Sci-Fi Sounds" and
// "Interface Sounds" packs (CC0, see assets/sfx/LICENSE-*.txt), converted to MP3.
//
// Browsers only allow audio after a user gesture, so nothing loads or plays
// until the first tap or key press. The engine is a looping clip whose pitch
// and brightness follow the climb speed (thrusterFire_004, soft-saturated for
// body); everything else is a one-shot.

const CLIPS = {
  engine: 0.58, ignition: 0.5, explosion: 0.75, "explosion-low": 0.9, flyby: 0.3,
  tick: 0.3, bet: 0.45, cashout: 0.6, error: 0.35, click: 0.18,
};
const MASTER = 0.8;

export function createAudio({ enabled: startEnabled = true } = {}) {
  let ctx = null, master = null, engine = null;
  let enabled = startEnabled;
  const buffers = {};

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = enabled ? MASTER : 0;
      // A limiter on the way out, so the engine, ignition and explosion never clip together.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.2;
      master.connect(limiter).connect(ctx.destination);
      for (const name of Object.keys(CLIPS)) {
        fetch(new URL(`../assets/sfx/${name}.mp3`, import.meta.url))
          .then((r) => r.arrayBuffer())
          .then((data) => ctx.decodeAudioData(data))
          .then((buf) => { buffers[name] = buf; })
          .catch(() => { /* a missing clip just stays silent */ });
      }
    }
    if (ctx.state === "suspended" && !document.hidden) ctx.resume();
  }
  for (const type of ["pointerdown", "keydown"]) document.addEventListener(type, unlock, { capture: true });
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else ctx.resume();
  });

  const ready = (name) => ctx && ctx.state === "running" && buffers[name];

  function play(name, { rate = 1, gain = 1 } = {}) {
    if (!enabled || !ready(name)) return;
    const src = ctx.createBufferSource();
    src.buffer = buffers[name];
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = CLIPS[name] * gain;
    src.connect(g).connect(master);
    src.start();
  }

  function startEngine() {
    if (engine || !enabled || !ready("engine")) return;
    const buf = buffers.engine;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = 0.15;                  // skip the MP3 encoder padding so the loop is seamless
    src.loopEnd = buf.duration - 0.15;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 450;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(filter).connect(g).connect(master);
    src.start(0, 0.15);
    g.gain.setTargetAtTime(CLIPS.engine, ctx.currentTime, 0.25);
    engine = { src, filter, g };
  }

  function stopEngine(fast = false) {
    if (!engine) return;
    const { src, g } = engine;
    engine = null;
    const t = ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(0, t, fast ? 0.03 : 0.35);
    src.stop(t + (fast ? 0.3 : 2));
  }

  return {
    play,
    /** Called every frame: keeps the engine loop running in flight and tunes it to the climb speed. */
    engine(flying, speedFraction) {
      if (!flying) return stopEngine();
      startEngine();
      if (!engine) return;
      const t = ctx.currentTime;
      engine.src.playbackRate.setTargetAtTime(0.75 + 0.55 * speedFraction, t, 0.25);
      engine.filter.frequency.setTargetAtTime(450 + 3500 * speedFraction, t, 0.25);
    },
    crash() {
      stopEngine(true);
      play("explosion");
      play("explosion-low");
    },
    get enabled() { return enabled; },
    setEnabled(on) {
      enabled = on;
      if (!on) stopEngine(true);
      if (master) master.gain.setTargetAtTime(on ? MASTER : 0, ctx.currentTime, 0.05);
    },
  };
}
