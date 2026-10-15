// Values that move every frame, shared by the stage readout and the read-data
// panel so both always show the same number.

/**
 * The multiplier to show right now. Between server ticks it follows the
 * contract's curve m(t) = e^(growthRate * t) from the server's launch time, but
 * never runs more than a quarter second ahead of the last tick. The server alone
 * decides the crash; once it reports one, this is the crash point.
 */
export function liveMultiplier(s) {
  const st = s.round.state;
  if (st === "crashed" || st === "settled") return s.round.crash ?? s.multiplier;
  if (st !== "in-flight" || !s.round.launchedAt) return 1;
  const k = s.config.growthRate;
  const elapsed = Math.max(0, (Date.now() + s.clockOffsetMs - Date.parse(s.round.launchedAt)) / 1000);
  const ceiling = Math.max(1, s.multiplier) * Math.exp(k * 0.25);
  return Math.max(s.multiplier, Math.floor(Math.min(Math.exp(k * elapsed), ceiling) * 100) / 100);
}

/** Seconds until boarding closes (0 outside the betting window). */
export function secondsLeft(s) {
  if (s.round.state !== "betting" || !s.round.closesAt) return 0;
  return Math.max(0, (Date.parse(s.round.closesAt) - (Date.now() + s.clockOffsetMs)) / 1000);
}

/** wager × multiplier rounded down to the cent, in integer maths (no 22.99 for 10 × 2.30). */
export function payoutAt(wager, multiplier) {
  return Math.floor((Math.round(Number(wager) * 100) * Math.round(multiplier * 100)) / 100) / 100;
}
