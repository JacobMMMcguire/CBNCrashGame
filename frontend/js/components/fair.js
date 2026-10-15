// Provably fair panel (placeholder): shows the published commitment, and the
// seed only once the round has crashed. Verification UI comes later.

import { t } from "../i18n.js";
import { setText } from "../store.js";

export function mountFair(store) {
  const commitment = document.getElementById("commitment");
  const seed = document.getElementById("seed");
  store.subscribe((s) => {
    const revealed = (s.round.state === "crashed" || s.round.state === "settled") && s.round.serverSeed;
    commitment.className = s.round.commitment ? "hash" : "hint";
    setText(commitment, s.round.commitment || t("fair.none"));
    seed.className = revealed ? "hash" : "hint";
    setText(seed, revealed ? s.round.serverSeed : t("fair.sealed"));
  });
}
