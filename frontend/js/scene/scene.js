// The flight scene: a canvas that animates whatever the server says is happening.
//
//   pad    rocket waits on the floodlit pad (betting window)
//   flight ignition smoke, a slow lift-off, then the climb speeds up to a
//          steady top speed: clouds rush past, the sky turns to deep space,
//          stars stretch into streaks and a planet passes every 10x
//   crash  the rocket explodes and the starfield coasts to a stop
//
// Visual speed follows the flight clock and levels off at a top speed; it does
// not follow the exponential multiplier, so the picture never "runs away".
// The scene never decides an outcome. stage.js feeds it the phase and the live
// multiplier each frame; the server owns the crash point.

import { drawAstronaut, drawBody, drawFlame, drawHills, drawRocket, drawTower } from "./art.js";
import { MILESTONES } from "./milestones.js";

const TOP_SPEED = 9;        // screen heights per second at full speed
const RAMP = 4.2;           // seconds: about 95% of top speed after ~7 s
const HOLD = 0.6;           // seconds on the pad while the engines spool up
const STAR_PARALLAX = 0.35;
const STAR_COUNT = 200;
const CLOUD_COUNT = 14;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const pick = (list) => list[(Math.random() * list.length) | 0];

// [x as a fraction of width, radius and peak height as fractions of the hill scale]
const HILLS = {
  back: [[-0.04, 0.6, 0.34], [0.24, 0.52, 0.4], [0.55, 0.62, 0.3], [0.86, 0.56, 0.42], [1.1, 0.55, 0.3]],
  mid: [[0.1, 0.44, 0.22], [0.38, 0.4, 0.17], [0.7, 0.48, 0.25], [1.02, 0.42, 0.2]],
  front: [[-0.06, 0.36, 0.11], [0.2, 0.3, 0.08], [0.5, 0.4, 0.06], [0.8, 0.34, 0.11], [1.06, 0.36, 0.09]],
};
// Sky [top, bottom] by altitude in screen heights: dusk on the pad, violet in the
// upper atmosphere, near-black in space.
const SKY = [
  [0, [21, 7, 41], [44, 18, 83]],
  [3, [11, 4, 26], [30, 10, 60]],
  [9, [4, 2, 11], [12, 5, 28]],
];
const STAR_TINTS = ["240,235,255", "240,235,255", "205,218,255", "255,228,200"];
const FIRE = ["#fff7cf", "#ffd84a", "#ffb547", "#ff7a3d", "#e8445a"];
const DEBRIS = ["#f3f3f5", "#c9525f", "#8b8b93", "#3f3f46"];
const NEBULAE = [
  [0.2, 0.25, 0.55, "150,60,210", 0.16], [0.85, 0.6, 0.5, "60,90,210", 0.13],
  [0.45, 1.15, 0.6, "220,80,160", 0.1], [0.1, 1.6, 0.45, "60,180,190", 0.09], [0.75, 1.85, 0.5, "120,70,220", 0.12],
];

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

/** Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7). */
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

/** Climb speed as a fraction of top speed, t seconds after launch: slow, then fast, then steady. */
const speedAt = (t) => {
  const u = Math.max(0, t - HOLD) / RAMP;
  return 1 - Math.exp(-u * u);
};

/** Distance climbed by t (in top-speed seconds): the exact integral of speedAt, so dropped frames never matter. */
const climbAt = (t) => {
  const s = Math.max(0, t - HOLD);
  return s - (RAMP * Math.sqrt(Math.PI) / 2) * erf(s / RAMP);
};

export function createScene(canvas, { reducedMotion = false, onMilestone = () => {} } = {}) {
  const ctx = canvas.getContext("2d");
  let W = 1, H = 1, dpr = 1;
  let RH = 100, padX = 0, groundY = 0, padY = 0, cruiseY = 0, hillScale = 100;
  let nebula = null;

  const stars = Array.from({ length: STAR_COUNT }, () => ({
    x: Math.random(), y: Math.random(), z: rand(0.25, 1) ** 1.6, r: rand(0.5, 1.7),
    tw: rand(0, Math.PI * 2), tint: pick(STAR_TINTS),
  }));

  let mode = "pad";
  let lastPhase = null;
  let cam = 0;           // how far the camera has climbed (px)
  let climb = 0;         // rocket altitude above the pad (px)
  let speed = 0;         // current climb speed (px/s)
  let power = 0;         // engine power 0..1 for the flame
  let intensity = 0;     // 0..1, rises with the multiplier (warp lines, flame)
  let flightTime = 0;
  let nextMilestone = 0;
  let rocketAlive = true;
  let flash = 0, shake = 0, fade = 0, ring = null, fireball = null;
  let time = 0, lastTrail = 0, emberDebt = 0;
  let puffs = [], sparks = [], bodies = [], streaks = [], astronauts = [], embers = [], clouds = [];

  function resize(width, height) {
    W = Math.max(1, width);
    H = Math.max(1, height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    RH = Math.max(80, Math.min(H * 0.34, W * 0.5, 300));
    padX = W / 2;
    groundY = H * 0.93;
    padY = groundY - RH * 0.045;
    cruiseY = Math.min(padY - 24, Math.max(H * 0.74, H * 0.4 + RH));
    hillScale = Math.max(W * 0.42, H * 0.36);
    nebula = paintNebula();
    if (clouds.length === 0) seedClouds();
  }

  const cruiseLift = () => padY - cruiseY;
  const rocketScreenY = () => padY - Math.min(climb, cruiseLift());

  /** Soft nebula clouds painted once per resize onto a tile two screens tall. */
  function paintNebula() {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(W / 2));
    c.height = Math.max(1, Math.round(H));   // half resolution: it is all soft gradients
    const g = c.getContext("2d");
    g.scale(0.5, 0.5);
    for (const [xf, yf, rf, color, a] of NEBULAE) {
      const r = rf * Math.max(W, H);
      for (const dy of [-2 * H, 0, 2 * H]) {  // wrap copies so the tile repeats seamlessly
        const x = xf * W, y = yf * H + dy;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(${color},${a})`);
        grad.addColorStop(1, `rgba(${color},0)`);
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    return c;
  }

  /** Flat-bottomed cloud banks (the reference art's style) one to six screens above the pad. */
  function seedClouds() {
    clouds = Array.from({ length: CLOUD_COUNT }, () => {
      const n = 4 + Math.floor(Math.random() * 3);
      return {
        x: rand(-0.1, 1.1), alt: rand(1, 6), w: rand(0.3, 0.65), a: rand(0.3, 0.6),
        // bumps along the top: [x offset as a fraction of width, radius as a fraction of width]
        bumps: Array.from({ length: n }, (_, i) => [(i + 0.5) / n - 0.5 + rand(-0.04, 0.04), rand(0.09, 0.17) * (i === 0 || i === n - 1 ? 0.7 : 1)]),
      };
    });
  }

  // ---------- Phase changes ----------

  function reset() {
    mode = "pad";
    cam = climb = speed = power = flightTime = intensity = 0;
    rocketAlive = true;
    puffs = []; sparks = []; bodies = []; streaks = []; astronauts = []; embers = [];
    ring = null; fireball = null; flash = 0; shake = 0; lastTrail = 0;
    fade = 1;
    nextMilestone = 0;
    seedClouds();
  }

  function ignite(m, elapsedMs) {
    mode = "flight";
    rocketAlive = true;
    nextMilestone = MILESTONES.findIndex((ms) => ms.at > m);
    if (nextMilestone < 0) nextMilestone = MILESTONES.length;
    if (elapsedMs > 1500) {
      power = 1;  // joined mid-flight: no lift-off replay
      return;
    }
    // Lift-off: the white cloud bank rolls out from the pad.
    const n = reducedMotion ? 16 : 36;
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const spread = rand(0, 1) ** 1.4;
      puffs.push({
        x: padX + side * spread * W * 0.55, y: groundY + rand(-0.02, 0.06) * H,
        r: RH * 0.04, tr: RH * rand(0.2, 0.42) * (1 - spread * 0.35), vx: side * rand(20, 150), vy: 0,
        age: -spread * 0.9, life: 9, front: Math.random() < 0.7,
      });
    }
  }

  function explode() {
    mode = "crash";
    if (!rocketAlive) return;
    rocketAlive = false;
    const x = padX, y = rocketScreenY() - RH * 0.5;
    const k = RH / 200;
    flash = reducedMotion ? 0.25 : 0.7;
    shake = reducedMotion ? 0 : 0.6;
    ring = { x, y, r: RH * 0.1, max: RH * 1.15, a: 1 };
    fireball = { x, y, age: 0 };
    const fire = reducedMotion ? 30 : 90;
    for (let i = 0; i < fire; i++) {
      const a = rand(0, Math.PI * 2), v = rand(40, 560) * k * (0.4 + Math.random());
      sparks.push({ kind: "fire", x: x + rand(-RH * 0.1, RH * 0.1), y: y + rand(-RH * 0.3, RH * 0.3),
        vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: rand(4, 13) * k * 2, age: 0, life: rand(0.5, 1.3), color: pick(FIRE) });
    }
    for (let i = 0; i < (reducedMotion ? 6 : 24); i++) {
      const a = rand(0, Math.PI * 2), v = rand(120, 480) * k * 1.4;
      sparks.push({ kind: "debris", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120 * k, size: rand(4, 13) * k * 2,
        rot: rand(0, 6), vr: rand(-9, 9), age: 0, life: rand(1.6, 2.6), color: pick(DEBRIS) });
    }
    for (let i = 0; i < (reducedMotion ? 8 : 26); i++) {
      const a = rand(0, Math.PI * 2), v = rand(10, 90) * k * 2;
      sparks.push({ kind: "smoke", x: x + rand(-RH * 0.15, RH * 0.15), y: y + rand(-RH * 0.3, RH * 0.3),
        vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: rand(10, 26) * k, age: 0, life: rand(1.6, 2.8) });
    }
  }

  function eject() {
    if (mode !== "flight" || !rocketAlive) return;
    // The astronaut kicks clear of the cockpit, then tumbles away as the rocket climbs on.
    const side = Math.random() < 0.5 ? -1 : 1;
    astronauts.push({ x: padX, y: rocketScreenY() - RH * 0.7, vx: side * rand(0.4, 0.55) * Math.min(W, 700), vy: -H * 0.2,
      age: 0, rot: 0, spin: side * rand(0.8, 1.6), phase: rand(0, 10) });
  }

  // ---------- Per-frame update ----------

  function update(f, dt) {
    time += dt;
    // Phase transitions driven by the server state
    if (f.phase === "pad" && mode !== "pad") reset();
    else if (f.phase === "flight" && mode === "pad") ignite(f.m, f.elapsedMs);
    else if (f.phase === "flight" && mode === "crash") { reset(); fade = 0.6; ignite(f.m, f.elapsedMs); }
    else if (f.phase === "crash" && mode === "flight") explode();
    else if (f.phase === "crash" && mode === "pad" && lastPhase === "pad") { ignite(1, 0); explode(); }
    lastPhase = f.phase;

    const top = H * TOP_SPEED;
    if (mode === "flight") {
      flightTime = Math.max(0, f.elapsedMs / 1000);
      speed = speedAt(flightTime) * top;
      intensity = clamp01(Math.log(Math.max(1, f.m)) / Math.log(100));
      power = Math.min(1, power + dt * 2.5);
      climb = Math.max(climb, climbAt(flightTime) * top);
      cam = Math.max(0, climb - cruiseLift());
      while (nextMilestone < MILESTONES.length && f.m >= MILESTONES[nextMilestone].at) {
        spawnBody(MILESTONES[nextMilestone], nextMilestone);
        onMilestone(MILESTONES[nextMilestone]);
        nextMilestone++;
      }
      emitExhaust(dt);
    } else if (mode === "crash") {
      speed *= Math.exp(-2.6 * dt);
      climb += speed * dt;
      cam = Math.max(0, climb - cruiseLift());
    }

    // Warp streaks once the climb is fast; denser as the multiplier rises
    const s = speed / top;
    if (!reducedMotion && s > 0.25) {
      const rate = (s - 0.25) * (60 + 90 * intensity);
      let n = rate * dt;
      while (n > 0) {
        if (Math.random() < n) {
          streaks.push({ x: rand(0, W), y: -H * 0.4, len: rand(0.2, 0.6) * H, v: rand(2.2, 4) * H * s, a: rand(0.05, 0.18) });
        }
        n -= 1;
      }
    }
    for (const st of streaks) st.y += st.v * dt;
    streaks = streaks.filter((st) => st.y - st.len < H);

    for (const p of puffs) {
      p.age += dt;
      if (p.age < 0) continue;
      p.r += (p.tr - p.r) * Math.min(1, dt * 1.6);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.exp(-1.1 * dt);
    }
    puffs = puffs.filter((p) => p.age < p.life && p.y + cam - p.r < H * 1.3);

    for (const e of embers) { e.age += dt; e.x += e.vx * dt; e.y += e.vy * dt; }
    embers = embers.filter((e) => e.age < e.life && e.y < H + 10);

    for (const b of bodies) b.y += b.vy * dt * Math.max(0.15, Math.min(1.4, speed / b.spawnSpeed));
    bodies = bodies.filter((b) => b.y - b.r * 3 < H);

    for (const p of sparks) {
      p.age += dt;
      const drag = p.kind === "smoke" ? 1.4 : p.kind === "fire" ? 3.2 : 0.6;
      p.vx *= Math.exp(-drag * dt);
      p.vy *= Math.exp(-drag * dt);
      if (p.kind === "debris") { p.vy += RH * 2.2 * dt; p.rot += p.vr * dt; }
      if (p.kind === "smoke") p.size += RH * 0.07 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt + speed * 0.12 * dt;
    }
    sparks = sparks.filter((p) => p.age < p.life);

    for (const c of astronauts) {
      c.age += dt;
      c.vy = Math.min(H * 0.22 + speed * 0.04, c.vy + H * 0.9 * dt);
      c.vx *= Math.exp(-1.8 * dt);
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.spin * dt;
    }
    astronauts = astronauts.filter((c) => c.age < 7 && c.y < H + RH);

    if (ring) { ring.r += (ring.max - ring.r) * Math.min(1, dt * 5); ring.a -= dt * 1.8; if (ring.a <= 0) ring = null; }
    if (fireball) { fireball.age += dt; fireball.y += speed * 0.12 * dt; if (fireball.age > 0.9) fireball = null; }
    flash = Math.max(0, flash - dt * 2.8);
    shake = Math.max(0, shake - dt * 2.2);
    fade = Math.max(0, fade - dt * 2.2);
  }

  /** Contrail puffs (world space, so they stream away below) and hot embers behind the nozzle. */
  function emitExhaust(dt) {
    const bottom = padY - climb;  // rocket nozzle in world space
    // Contrail: one puff every ~RH/9 of climb while inside the atmosphere
    const spacing = RH * 0.06;
    if (cam < H * 6) {
      let made = 0;
      while (lastTrail - bottom > spacing && made < 10) {
        lastTrail -= spacing;
        made++;
        const thin = clamp01(cam / (H * 6));
        puffs.push({ x: padX + rand(-0.03, 0.03) * RH, y: lastTrail + RH * 0.12, r: RH * 0.08, tr: RH * rand(0.13, 0.21) * (1 + thin),
          vx: rand(-40, 40), vy: rand(10, 50), age: 0, life: 2.6, front: false, trail: 0.85 * (1 - thin) });
      }
    } else {
      lastTrail = bottom;
    }
    if (lastTrail === 0 || lastTrail < bottom - H) lastTrail = bottom;
    // Embers: short-lived sparks shooting down out of the flame
    if (reducedMotion) return;
    const s = speed / (H * TOP_SPEED);
    emberDebt += dt * (25 + 70 * s);
    const y = rocketScreenY() + RH * (0.2 + 0.3 * s);
    while (emberDebt >= 1) {
      emberDebt -= 1;
      embers.push({ x: padX + rand(-0.035, 0.035) * RH, y: y + rand(0, RH * 0.15), vx: rand(-25, 25),
        vy: H * rand(0.4, 0.9) + speed * 0.18, age: 0, life: rand(0.25, 0.55), r: rand(1, 2.4) * (RH / 200), color: pick(FIRE) });
    }
  }

  function spawnBody(spec, index) {
    const r = Math.min(W, H) * 0.15 * spec.size;
    const left = index % 2 === 0;
    const inset = W < 600 ? W * 0.12 : Math.max(r * 0.8, Math.min(W * 0.3, W * 0.5 - RH * 0.45 - r * 1.1));
    const x = left ? inset : W - inset;
    bodies.push({ spec, x, y: -r * 2.4, r, vy: (H + r * 5) / 3.4, spawnSpeed: Math.max(speed, 1) });
  }

  // ---------- Drawing ----------

  function skyAt(altScreens) {
    let i = 0;
    while (i < SKY.length - 2 && altScreens > SKY[i + 1][0]) i++;
    const [a0, t0, b0] = SKY[i], [a1, t1, b1] = SKY[i + 1];
    const t = clamp01((altScreens - a0) / (a1 - a0));
    return [rgb(mix(t0, t1, t)), rgb(mix(b0, b1, t))];
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const alt = cam / H;
    const [top, bottom] = skyAt(alt);
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, top);
    sky.addColorStop(1, bottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    if (shake > 0) ctx.translate(rand(-1, 1) * shake * RH * 0.025, rand(-1, 1) * shake * RH * 0.025);

    // Nebulae fade in once the rocket leaves the atmosphere
    const nebulaAlpha = clamp01((alt - 2) / 5);
    if (nebula && nebulaAlpha > 0) {
      const off = ((cam * 0.03) % (2 * H) + 2 * H) % (2 * H);
      ctx.globalAlpha = nebulaAlpha;
      ctx.drawImage(nebula, 0, off - 2 * H, W, 2 * H);
      ctx.drawImage(nebula, 0, off, W, 2 * H);
      ctx.globalAlpha = 1;
    }

    drawStars();
    for (const st of streaks) {
      const g = ctx.createLinearGradient(0, st.y - st.len, 0, st.y);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(1, `rgba(230,220,255,${st.a})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(st.x, st.y - st.len);
      ctx.lineTo(st.x, st.y);
      ctx.stroke();
    }
    for (const b of bodies) drawBody(ctx, b.spec, b.x, b.y, b.r, time);

    drawClouds(false);
    if (cam < H * 1.8) drawGround();
    drawPuffs(false);
    drawEmbers();

    if (rocketAlive) {
      let x = padX, y = rocketScreenY(), tilt = 0;
      if (mode === "flight" && !reducedMotion) {
        // Engine vibration: sub-pixel to ~1px, a little stronger as the climb speeds up
        const sf = speed / (H * TOP_SPEED);
        const k = RH * (flightTime < HOLD + 0.8 ? 0.004 : 0.0028 * (0.35 + 0.65 * sf));
        x += k * (Math.sin(time * 53.1) + 0.6 * Math.sin(time * 97.3 + 1.7));
        y += k * 0.6 * (Math.sin(time * 61.7 + 0.4) + 0.5 * Math.sin(time * 113.9 + 2.1));
        tilt = Math.sin(time * 1.3) * 0.006 * power;
      }
      if (mode === "flight" && flightTime > HOLD * 0.5) {
        const flameSize = Math.min(power, 0.3 + 0.55 * speed / (H * TOP_SPEED) + 0.15 * intensity);
        drawFlame(ctx, x, y, RH, flameSize, reducedMotion ? 0.5 : Math.random());
      }
      drawRocket(ctx, x, y, RH, tilt);
    }
    drawPuffs(true);
    drawClouds(true);
    for (const c of astronauts) drawAstronaut(ctx, c.x, c.y, RH * 0.3, reducedMotion ? c.phase : c.age + c.phase, reducedMotion ? 0 : c.rot);
    drawFireball();
    drawSparks();

    if (ring) {
      ctx.strokeStyle = `rgba(255,220,160,${ring.a * 0.8})`;
      ctx.lineWidth = RH * 0.03 * ring.a + 1;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const vig = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.8);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(6,1,16,0.55)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
    if (flash > 0) { ctx.fillStyle = `rgba(255,236,200,${flash * 0.55})`; ctx.fillRect(0, 0, W, H); }
    if (fade > 0) { ctx.fillStyle = `rgba(10,3,24,${fade})`; ctx.fillRect(0, 0, W, H); }
  }

  function drawStars() {
    const exposure = 0.12;
    ctx.lineCap = "round";
    for (const st of stars) {
      const v = speed * st.z * STAR_PARALLAX;
      const y = (((st.y * H + cam * st.z * STAR_PARALLAX) % H) + H) % H;
      const x = st.x * W;
      let len = v * exposure;
      len = reducedMotion ? Math.min(len, 3) : Math.min(len, H * 0.5);
      const twinkle = mode === "pad" ? 0.7 + 0.3 * Math.sin(time * 2 + st.tw) : 1;
      const a = (0.3 + 0.7 * st.z) * twinkle;
      if (len < 2) {
        ctx.fillStyle = `rgba(${st.tint},${a})`;
        ctx.beginPath();
        ctx.arc(x, y, st.r * (0.6 + st.z * 0.6), 0, Math.PI * 2);
        ctx.fill();
      } else {
        const g = ctx.createLinearGradient(0, y - len, 0, y);
        g.addColorStop(0, `rgba(${st.tint},0)`);
        g.addColorStop(1, `rgba(${st.tint},${Math.min(1, a * 1.1)})`);
        ctx.strokeStyle = g;
        ctx.lineWidth = st.r * (0.8 + st.z);
        ctx.beginPath();
        ctx.moveTo(x, y - len);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    }
  }

  /** Cloud banks rushing past; at speed each leaves fading ghost copies above it (motion blur). */
  function drawClouds(front) {
    const trail = reducedMotion ? 0 : Math.min(H * 0.25, speed * 0.02);
    for (const [i, c] of clouds.entries()) {
      if ((i % 3 === 0) !== front) continue;   // a third of the banks pass in front of the rocket
      const w = c.w * Math.max(W, 420);
      const y = groundY - c.alt * H + cam;
      if (y < -w * 0.4 - trail * 3 || y - w * 0.2 > H) continue;
      const a = c.a * (front ? 0.5 : 0.85);
      const ghosts = trail < 4 ? 0 : 6;
      for (let g = ghosts; g >= 0; g--) {
        cloudShape(c, c.x * W, y - g * trail * 0.5, w, g === 0 ? a : a * 0.14 * (1 - g / (ghosts + 1)));
      }
    }
  }

  function cloudShape(c, cx, baseY, w, a) {
    ctx.fillStyle = `rgba(228,218,248,${a})`;
    ctx.beginPath();
    for (const [dx, rf] of c.bumps) {
      const r = rf * w;
      ctx.moveTo(cx + dx * w + r, baseY - r * 0.55);
      ctx.arc(cx + dx * w, baseY - r * 0.55, r, 0, Math.PI * 2);
    }
    ctx.rect(cx - w * 0.5, baseY - w * 0.06, w, w * 0.06);
    ctx.fill();
  }

  function drawGround() {
    const S = hillScale;
    drawHills(ctx, HILLS.back, "#37185f", groundY - S * 0.02 + cam * 0.75, W, S);
    drawHills(ctx, HILLS.mid, "#2a1450", groundY + S * 0.04 + cam * 0.88, W, S);
    const gy = groundY + cam;
    drawFloodlights(gy);
    drawTower(ctx, padX + RH * 0.62, gy - RH * 0.03, RH * 1.05, time);
    drawHills(ctx, HILLS.front, "#150a26", gy + S * 0.06, W, S);
    // Launch platform
    ctx.fillStyle = "#0e061d";
    ctx.fillRect(padX - RH * 0.5, gy - RH * 0.045, RH, RH * 0.045);
    ctx.fillRect(padX - RH * 0.36, gy - RH * 0.01, RH * 0.72, RH * 0.6);
    ctx.fillStyle = mode === "pad" && Math.sin(time * 3) > 0 ? "#ffd84a" : "#7a5a1a";
    for (const dx of [-0.44, -0.22, 0.22, 0.44]) ctx.fillRect(padX + dx * RH - 1.5, gy - RH * 0.045, 3, 3);
  }

  /** Two searchlight beams from the ground onto the rocket. */
  function drawFloodlights(gy) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const side of [-1, 1]) {
      const sx = padX + side * RH * 1.15, sy = gy - RH * 0.02;
      const tx = padX + side * RH * 0.05, ty = gy - RH * 0.75;
      const g = ctx.createLinearGradient(sx, sy, tx, ty);
      g.addColorStop(0, "rgba(255,236,190,0.16)");
      g.addColorStop(1, "rgba(255,236,190,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx - RH * 0.28, ty - RH * 0.1);
      ctx.lineTo(tx + RH * 0.28, ty + RH * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,240,200,0.9)";
      ctx.fillRect(sx - 2, sy - 2, 4, 3);
    }
    ctx.restore();
  }

  function drawPuffs(front) {
    for (const p of puffs) {
      if (p.front !== front || p.age < 0) continue;
      const fadeOut = clamp01((p.life - p.age) / 1.2);
      const base = p.trail !== undefined ? p.trail : front ? 1 : 0.85;
      const a = base * fadeOut;
      if (a <= 0.01) continue;
      ctx.fillStyle = front ? `rgba(241,241,241,${a})` : `rgba(221,214,234,${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y + cam, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawEmbers() {
    if (embers.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const e of embers) {
      ctx.globalAlpha = Math.max(0, 1 - e.age / e.life);
      ctx.fillStyle = e.color;
      ctx.fillRect(e.x - e.r / 2, e.y, e.r, e.r * (1 + speed / H * 0.8));
    }
    ctx.restore();
  }

  // The core blast: swells fast, then burns out from white to orange.
  function drawFireball() {
    if (!fireball) return;
    const t = fireball.age;
    const r = RH * (0.18 + 0.42 * (1 - Math.exp(-t * 9)));
    const a = t < 0.2 ? 1 : Math.max(0, 1 - (t - 0.2) / 0.7);
    const g = ctx.createRadialGradient(fireball.x, fireball.y, 0, fireball.x, fireball.y, r);
    g.addColorStop(0, `rgba(255,250,225,${a})`);
    g.addColorStop(0.35, `rgba(255,216,74,${a * 0.95})`);
    g.addColorStop(0.7, `rgba(255,122,61,${a * 0.75})`);
    g.addColorStop(1, "rgba(232,68,90,0)");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(fireball.x, fireball.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSparks() {
    for (const p of sparks) {
      const t = p.age / p.life;
      if (p.kind === "smoke") {
        ctx.fillStyle = `rgba(92,74,122,${0.45 * (1 - t) ** 1.5})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of sparks) {
      if (p.kind !== "fire") continue;
      const t = p.age / p.life;
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - t * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    for (const p of sparks) {
      if (p.kind !== "debris") continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - (p.age / p.life) ** 3);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
  }

  return {
    resize,
    eject,
    /** Climb speed as a fraction of top speed (0..1), for the engine sound. */
    speedFraction: () => (mode === "flight" ? speed / (H * TOP_SPEED) : 0),
    /** Advance and draw one frame. f = { phase: "pad"|"flight"|"crash", m, elapsedMs } */
    frame(f, dt) {
      update(f, Math.min(dt, 0.05));
      render();
    },
  };
}
