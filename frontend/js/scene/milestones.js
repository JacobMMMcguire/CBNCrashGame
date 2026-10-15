// Flyby milestones, in true order outward from Earth: a body drifts past the
// rocket each time the multiplier crosses `at` (every 10x up to 90x, then the
// Andromeda Galaxy at 100x and a quasar at 1000x). Pure data, so adding a
// body is one entry here plus a `body.<key>` string in each locale. `size`
// scales the radius; drawing details are read by art.drawBody.

export const MILESTONES = [
  {
    at: 10, key: "moon", size: 0.85,
    base: "#d7d4e3",
    spots: [[-0.35, -0.2, 0.22, "#b9b4ca"], [0.25, 0.3, 0.16, "#b9b4ca"], [0.3, -0.35, 0.1, "#c4bfd4"],
            [-0.1, 0.45, 0.09, "#c4bfd4"], [-0.55, 0.3, 0.08, "#b9b4ca"]],
    glow: "rgba(220,215,255,0.18)",
  },
  {
    at: 20, key: "mars", size: 0.75,
    base: "#d4643f",
    spots: [[-0.3, 0.1, 0.35, "#b54d2f"], [0.35, -0.25, 0.2, "#e07a52"], [0.2, 0.45, 0.25, "#b54d2f"]],
    spotSquash: 0.6, cap: "#f6eee8",
    glow: "rgba(255,120,80,0.16)",
  },
  {
    at: 30, key: "jupiter", size: 1.1,
    base: "#e2b07c",
    bands: [[-0.8, 0.18, "#c98d5c"], [-0.45, 0.14, "#f3d8b4"], [-0.15, 0.2, "#b9744a"],
            [0.2, 0.12, "#f3d8b4"], [0.42, 0.2, "#c98d5c"], [0.75, 0.15, "#dba679"]],
    spots: [[0.3, 0.28, 0.17, "#c0523a"]], spotSquash: 0.6,
    glow: "rgba(255,190,130,0.14)",
  },
  {
    at: 40, key: "saturn", size: 0.8,
    base: "#e3c27a",
    bands: [[-0.55, 0.14, "#d4ad60"], [-0.2, 0.1, "#f0d89c"], [0.1, 0.18, "#c9a35b"], [0.45, 0.12, "#d9b56a"]],
    ring: { size: 1.85, flat: 0.32, width: 0.22, tilt: -0.32, color: "#f0dca0", inner: "#c9a35b" },
    glow: "rgba(255,220,140,0.14)",
  },
  {
    at: 50, key: "uranus", size: 0.8,
    base: "#9fe6e4",
    bands: [[-0.3, 0.12, "#b8f0ee"], [0.25, 0.1, "#86d4d2"]],
    ring: { size: 1.5, flat: 0.95, width: 0.05, tilt: 1.35, color: "rgba(220,255,255,0.55)" },
    glow: "rgba(150,240,240,0.16)",
  },
  {
    at: 60, key: "neptune", size: 0.85,
    base: "#4f6fe6",
    bands: [[-0.5, 0.12, "#3d58c4"], [0.05, 0.16, "#6584f0"], [0.45, 0.1, "#3d58c4"]],
    spots: [[-0.25, 0.15, 0.16, "#2a3e94"]], spotSquash: 0.55,
    glow: "rgba(100,140,255,0.2)",
  },
  {
    at: 70, key: "pluto", size: 0.55,
    base: "#cfae94",
    spots: [[0.15, 0.2, 0.38, "#f2e4d6"], [-0.45, -0.3, 0.2, "#a8846c"]],
    glow: "rgba(240,210,190,0.14)",
  },
  {
    at: 80, key: "proxima", size: 1.3,
    base: "#ff7b4a",
    spots: [[-0.25, -0.2, 0.3, "#ff9a5c"], [0.3, 0.25, 0.2, "#e85c35"]],
    glow: "rgba(255,120,70,0.45)", pulse: true,
  },
  {
    at: 90, key: "kepler", size: 1.0,
    base: "#2fa59a",
    spots: [[-0.3, -0.25, 0.3, "#3fbf7a"], [0.35, 0.2, 0.28, "#3fbf7a"], [0.0, 0.55, 0.2, "#e9f6f2"],
            [-0.4, 0.35, 0.18, "#e9f6f2"]],
    spotSquash: 0.7,
    glow: "rgba(90,230,200,0.2)",
  },
  { at: 100, key: "andromeda", size: 1.4, kind: "galaxy", tilt: -0.5 },
  { at: 1000, key: "quasar", size: 0.7, kind: "quasar", tilt: 0.35 },
];
