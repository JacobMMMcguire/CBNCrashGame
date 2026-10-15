// Session stats (placeholder). Real stats (rounds, net result, best multiplier,
// session time) come later; for now it only shows the configured reality-check interval.

import { t } from "../i18n.js";
import { setText } from "../store.js";

export function mountSession(store) {
  const panel = document.querySelector(".stats");
  const line = document.createElement("p");
  line.className = "note";
  panel.append(line);
  store.subscribe((s) => {
    const n = s.config.realityCheckMinutes;
    setText(line, n > 0 ? t("stats.reality", { n }) : t("stats.realityOff"));
  });
}
