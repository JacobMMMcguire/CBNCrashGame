// Flat vector art drawn on a 2D canvas, in the style of the night-launch reference:
// a white orbiter on a coral tank with grey boosters, a yellow flame, and planets
// built from simple shapes. Every function draws at a given position and size, so
// the scene can scale to any stage.

export const PALETTE = {
  orbiter: "#f3f3f5",
  orbiterShade: "#d9d9e0",
  dark: "#3f3f46",
  tank: "#c9525f",
  tankShade: "#a8414d",
  booster: "#8b8b93",
  boosterShade: "#74747c",
  flame: "#ffd84a",
  flameCore: "#fff7cf",
  flameGlow: "rgba(255, 186, 70, ",
  smoke: "#f1f1f1",
};

/**
 * The shuttle stack. (x, y) is the bottom centre of the engine bells and h is the
 * full height. Drawn in a 100-unit tall local space (y up is negative).
 */
export function drawRocket(ctx, x, y, h, tilt = 0) {
  const u = h / 100;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.scale(u, u);
  ctx.lineJoin = "round";

  // Solid rocket boosters (behind the tank)
  for (const side of [-1, 1]) {
    const x0 = side * 16, x1 = side * 26;
    const l = Math.min(x0, x1), w = Math.abs(x1 - x0);
    ctx.fillStyle = "#55555c";
    ctx.beginPath();
    ctx.moveTo(l + 1, -6); ctx.lineTo(l + w - 1, -6); ctx.lineTo(l + w + 1, 0); ctx.lineTo(l - 1, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = PALETTE.booster;
    ctx.beginPath();
    ctx.moveTo(l, -6);
    ctx.lineTo(l, -70);
    ctx.bezierCurveTo(l, -80, l + w / 2 - 1, -87, l + w / 2, -88);
    ctx.bezierCurveTo(l + w / 2 + 1, -87, l + w, -80, l + w, -70);
    ctx.lineTo(l + w, -6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = PALETTE.boosterShade;
    ctx.fillRect(side > 0 ? l + w * 0.62 : l, -70, w * 0.38, 64);
    ctx.fillStyle = "#2b2b33";
    ctx.fillRect(l, -68, w, 1.4);
    ctx.fillRect(l, -65.4, w, 1.4);
    ctx.fillRect(l + w / 2 - 1.4, -58, 2.8, 2.8);
    ctx.fillRect(l, -12, w, 1.2);
  }

  // External tank
  ctx.fillStyle = PALETTE.tank;
  ctx.beginPath();
  ctx.moveTo(-15, -12);
  ctx.lineTo(-15, -74);
  ctx.bezierCurveTo(-15, -93, -6, -100, 0, -100);
  ctx.bezierCurveTo(6, -100, 15, -93, 15, -74);
  ctx.lineTo(15, -12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PALETTE.tankShade;
  ctx.fillRect(8, -74, 7, 62);
  ctx.fillStyle = "#2b1d33";
  ctx.fillRect(-15, -75, 30, 1.6);

  // Orbiter
  const orbiter = new Path2D(
    "M0 -87 C-4 -87 -6.5 -81 -6.5 -72 L-7.5 -44 C-8.5 -32 -20 -24 -31 -16 L-31 -13 " +
    "L31 -13 L31 -16 C20 -24 8.5 -32 7.5 -44 L6.5 -72 C6.5 -81 4 -87 0 -87 Z");
  ctx.fillStyle = PALETTE.orbiter;
  ctx.fill(orbiter);
  ctx.save();
  ctx.clip(orbiter);
  ctx.fillStyle = PALETTE.dark;
  ctx.fillRect(-10, -90, 20, 14);              // nose cone
  ctx.fillStyle = PALETTE.orbiterShade;
  ctx.fillRect(3.5, -76, 30, 63);              // right-side shade
  ctx.restore();
  ctx.fillStyle = PALETTE.tank;
  ctx.fillRect(-4.5, -67, 9, 1.4);             // red bar under the nose
  ctx.fillRect(-0.45, -60, 0.9, 46);           // red centre line
  ctx.fillStyle = PALETTE.dark;                // dark underside of the wings
  ctx.beginPath();
  ctx.moveTo(-31, -13); ctx.lineTo(31, -13); ctx.lineTo(28.5, -8.5); ctx.lineTo(-28.5, -8.5);
  ctx.closePath(); ctx.fill();

  // Engine bells
  for (const bx of [-5.5, 5.5]) {
    ctx.fillStyle = "#ececf0";
    ctx.beginPath();
    ctx.moveTo(bx - 2.6, -9);
    ctx.lineTo(bx + 2.6, -9);
    ctx.quadraticCurveTo(bx + 4.2, -3, bx + 3.8, -0.5);
    ctx.quadraticCurveTo(bx, 0.6, bx - 3.8, -0.5);
    ctx.quadraticCurveTo(bx - 4.2, -3, bx - 2.6, -9);
    ctx.fill();
  }
  ctx.restore();
}

/** Main engine flame below (x, y). `power` 0..1 stretches it; `flicker` varies it per frame. */
export function drawFlame(ctx, x, y, h, power, flicker) {
  const u = h / 100;
  const len = (14 + power * 46 + flicker * 6) * u;
  const w = 11 * u;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  // Glow: a circle, so it fades out evenly in every direction (a rectangle here
  // left a hard horizontal edge across the wings).
  const cy = y + len * 0.35, R = len * 0.95 + w;
  const glow = ctx.createRadialGradient(x, cy, 0, x, cy, R);
  glow.addColorStop(0, PALETTE.flameGlow + (0.55 + power * 0.25) + ")");
  glow.addColorStop(0.55, PALETTE.flameGlow + (0.18 + power * 0.08) + ")");
  glow.addColorStop(1, PALETTE.flameGlow + "0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = PALETTE.flame;
  roundedFlame(ctx, x, y - 1 * u, w, len);
  ctx.fillStyle = PALETTE.flameCore;
  roundedFlame(ctx, x, y - 1 * u, w * 0.5, len * 0.62);
  // Mach diamonds: bright shock nodes in the exhaust at full power
  if (power > 0.45) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(0.9, (power - 0.45) * 2)})`;
    for (const f of [0.2, 0.4, 0.6]) {
      ctx.beginPath();
      ctx.ellipse(x, y + len * f, w * 0.2, w * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function roundedFlame(ctx, x, y, w, len) {
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.lineTo(x + w / 2, y);
  ctx.lineTo(x + w / 2, y + len - w / 2);
  ctx.quadraticCurveTo(x + w / 2, y + len, x, y + len + w * 0.25);
  ctx.quadraticCurveTo(x - w / 2, y + len, x - w / 2, y + len - w / 2);
  ctx.closePath();
  ctx.fill();
}

/**
 * The ejected astronaut, drawn in the shuttle's flat style. (x, y) is the
 * centre of the torso, s the full height, rot the tumble angle, and t a clock
 * that makes the arms and legs flail (each limb on its own rhythm).
 */
export function drawAstronaut(ctx, x, y, s, t, rot = 0) {
  const u = s / 100;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(u, u);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const limb = (x0, y0, a1, l1, bend, l2, width, end) => {
    const x1 = x0 + Math.cos(a1) * l1, y1 = y0 + Math.sin(a1) * l1;
    const a2 = a1 + bend;
    const x2 = x1 + Math.cos(a2) * l2, y2 = y1 + Math.sin(a2) * l2;
    ctx.strokeStyle = PALETTE.orbiter;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.strokeStyle = PALETTE.orbiterShade;     // a thin seam down each limb
    ctx.lineWidth = width * 0.22;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    end(x2, y2, a2);
  };
  const glove = (gx, gy) => {
    ctx.fillStyle = PALETTE.booster;
    ctx.beginPath();
    ctx.arc(gx, gy, 6.2, 0, Math.PI * 2);
    ctx.fill();
  };
  const boot = (bx, by, a) => {
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(a - Math.PI / 2);
    ctx.fillStyle = PALETTE.booster;
    ctx.beginPath();
    ctx.roundRect(-7, -3, 14, 10, 3);
    ctx.fill();
    ctx.restore();
  };

  // Backpack (life support), peeking out behind the torso
  ctx.fillStyle = PALETTE.booster;
  ctx.beginPath();
  ctx.roundRect(-22, -22, 44, 36, 6);
  ctx.fill();
  ctx.fillStyle = PALETTE.boosterShade;
  ctx.fillRect(10, -22, 12, 36);

  // Legs and arms flail: each joint swings on its own frequency
  const w = (f, p, amp) => Math.sin(t * f + p) * amp;
  limb(-9, 16, Math.PI / 2 + 0.3 + w(7.1, 0, 0.45), 17, -0.35 + w(9.3, 1, 0.3), 16, 12, boot);
  limb(9, 16, Math.PI / 2 - 0.3 + w(6.3, 2, 0.45), 17, 0.35 + w(8.7, 3, 0.3), 16, 12, boot);
  limb(-16, -12, Math.PI - 0.6 + w(8.9, 0.5, 0.7), 15, -0.5 + w(11.2, 1.7, 0.5), 14, 10.5, glove);
  limb(16, -12, -0.6 + w(8.1, 2.2, -0.7), 15, 0.5 + w(10.4, 0.3, -0.5), 14, 10.5, glove);

  // Torso
  ctx.fillStyle = PALETTE.orbiter;
  ctx.beginPath();
  ctx.roundRect(-17, -20, 34, 40, 9);
  ctx.fill();
  ctx.fillStyle = PALETTE.orbiterShade;
  ctx.beginPath();
  ctx.roundRect(6, -20, 11, 40, [0, 9, 9, 0]);
  ctx.fill();
  ctx.fillStyle = PALETTE.dark;
  ctx.fillRect(-17, 11, 34, 4);                  // belt
  ctx.fillStyle = PALETTE.tank;                  // chest control panel
  ctx.beginPath();
  ctx.roundRect(-9, -9, 15, 11, 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.flame;
  ctx.fillRect(-6, -6, 3, 3);
  ctx.fillStyle = "#4be3a4";
  ctx.fillRect(-1, -6, 3, 3);

  // Helmet with a dark visor and a flame-coloured reflection
  ctx.fillStyle = PALETTE.orbiter;
  ctx.beginPath();
  ctx.arc(0, -36, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.orbiterShade;
  ctx.beginPath();
  ctx.arc(0, -36, 18, -0.9, 1.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#2b2b33";
  ctx.beginPath();
  ctx.ellipse(1, -36, 12.5, 9.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,216,74,0.85)";
  ctx.beginPath();
  ctx.ellipse(-4, -39.5, 4.5, 2.2, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.beginPath();
  ctx.arc(5, -32, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A planet or star from a spec in milestones.js, centred on (x, y) with radius r. */
export function drawBody(ctx, spec, x, y, r, t) {
  if (spec.kind === "galaxy") return drawGalaxy(ctx, spec, x, y, r, t);
  if (spec.kind === "quasar") return drawQuasar(ctx, spec, x, y, r, t);
  ctx.save();
  if (spec.glow) {
    const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2.2);
    g.addColorStop(0, spec.glow);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4);
  }
  if (spec.ring) ring(ctx, spec.ring, x, y, r, true);

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = spec.base;
  ctx.fill();
  ctx.save();
  ctx.clip();
  for (const [yf, hf, color] of spec.bands || []) {
    ctx.fillStyle = color;
    ctx.fillRect(x - r, y + yf * r, r * 2, hf * r);
  }
  for (const [dx, dy, rf, color] of spec.spots || []) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x + dx * r, y + dy * r, rf * r, rf * r * (spec.spotSquash || 1), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (spec.cap) {
    ctx.fillStyle = spec.cap;
    ctx.beginPath();
    ctx.ellipse(x, y - r * 0.95, r * 0.45, r * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Flat shading: a lit edge at the top left, a shadow at the bottom right
  const shade = ctx.createRadialGradient(x - r * 0.45, y - r * 0.45, r * 0.15, x, y, r * 1.15);
  shade.addColorStop(0, "rgba(255,255,255,0.16)");
  shade.addColorStop(0.55, "rgba(255,255,255,0)");
  shade.addColorStop(1, "rgba(12,3,30,0.5)");
  ctx.fillStyle = shade;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  if (spec.pulse) {
    ctx.fillStyle = `rgba(255,240,200,${0.08 + 0.06 * Math.sin(t * 3)})`;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();

  if (spec.ring) ring(ctx, spec.ring, x, y, r, false);
  ctx.restore();
}

/** A tilted spiral galaxy: a glowing core and two curling arms of dots. */
function drawGalaxy(ctx, spec, x, y, r, t) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spec.tilt || -0.5);
  ctx.scale(1, 0.45);
  ctx.globalCompositeOperation = "lighter";
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.6);
  halo.addColorStop(0, "rgba(255,240,220,0.75)");
  halo.addColorStop(0.18, "rgba(230,190,255,0.35)");
  halo.addColorStop(1, "rgba(120,80,220,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2);
  ctx.fill();
  for (let arm = 0; arm < 2; arm++) {
    for (let i = 0; i < 90; i++) {
      const k = i / 90;
      const a = arm * Math.PI + k * Math.PI * 2.6 + t * 0.05;
      const d = r * (0.12 + k * 1.35);
      const jitter = Math.sin(i * 12.9898 + arm) * r * 0.06;
      ctx.fillStyle = `rgba(${k < 0.5 ? "255,225,240" : "180,200,255"},${0.55 * (1 - k)})`;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * d + jitter, Math.sin(a) * d + jitter, r * (0.05 - k * 0.03), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** A quasar: a blinding core with two narrow relativistic jets. */
function drawQuasar(ctx, spec, x, y, r, t) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spec.tilt || 0.35);
  ctx.globalCompositeOperation = "lighter";
  for (const dir of [-1, 1]) {
    const jet = ctx.createLinearGradient(0, 0, 0, dir * r * 2.6);
    jet.addColorStop(0, "rgba(170,210,255,0.8)");
    jet.addColorStop(1, "rgba(120,140,255,0)");
    ctx.fillStyle = jet;
    ctx.beginPath();
    ctx.moveTo(-r * 0.08, 0);
    ctx.lineTo(r * 0.08, 0);
    ctx.lineTo(r * 0.02, dir * r * 2.6);
    ctx.lineTo(-r * 0.02, dir * r * 2.6);
    ctx.closePath();
    ctx.fill();
  }
  const pulse = 0.85 + 0.15 * Math.sin(t * 6);
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, r * pulse);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(0.2, "rgba(210,225,255,0.85)");
  core.addColorStop(1, "rgba(110,90,255,0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, r * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function ring(ctx, spec, x, y, r, back) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spec.tilt);
  ctx.strokeStyle = spec.color;
  ctx.lineWidth = r * spec.width;
  ctx.beginPath();
  // The back half is the upper arc, drawn before the planet; the front half after it.
  ctx.ellipse(0, 0, r * spec.size, r * spec.size * spec.flat, 0, back ? Math.PI : 0, back ? Math.PI * 2 : Math.PI);
  ctx.stroke();
  if (spec.inner) {
    ctx.strokeStyle = spec.inner;
    ctx.lineWidth = r * spec.width * 0.35;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * (spec.size - spec.width * 0.2), r * (spec.size - spec.width * 0.2) * spec.flat, 0,
      back ? Math.PI : 0, back ? Math.PI * 2 : Math.PI);
    ctx.stroke();
  }
  ctx.restore();
}

/** A rounded hill layer: circles whose tops rise above `baseY`. */
export function drawHills(ctx, hills, color, baseY, W, S) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (const [xf, rf, lift] of hills) {
    const r = rf * S;
    ctx.moveTo(xf * W + r, baseY + r - lift * S);
    ctx.arc(xf * W, baseY + r - lift * S, r, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.fillRect(0, baseY, W, S * 3);
}

/** Launch tower: a dark lattice with a blinking red beacon. */
export function drawTower(ctx, x, groundY, h, t) {
  const w = h * 0.09;
  ctx.save();
  ctx.fillStyle = "#120822";
  ctx.fillRect(x - w / 2, groundY - h, w, h);
  ctx.strokeStyle = "#2a1846";
  ctx.lineWidth = Math.max(1, w * 0.12);
  ctx.beginPath();
  const step = w * 1.1;
  for (let yy = groundY - h + step; yy < groundY; yy += step) {
    ctx.moveTo(x - w / 2, yy); ctx.lineTo(x + w / 2, yy - step);
    ctx.moveTo(x + w / 2, yy); ctx.lineTo(x - w / 2, yy - step);
  }
  ctx.stroke();
  ctx.fillStyle = "#120822";
  ctx.fillRect(x - w / 2, groundY - h * 0.72, h * 0.22, w * 0.45);   // service arm
  const on = Math.sin(t * 4) > 0;
  ctx.fillStyle = on ? "#ff4d6a" : "#5a1a2a";
  ctx.beginPath();
  ctx.arc(x, groundY - h - w * 0.4, w * 0.32, 0, Math.PI * 2);
  ctx.fill();
  if (on) {
    ctx.fillStyle = "rgba(255,77,106,0.25)";
    ctx.beginPath();
    ctx.arc(x, groundY - h - w * 0.4, w * 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
