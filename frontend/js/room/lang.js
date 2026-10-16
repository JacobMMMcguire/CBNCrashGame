// Language for the room pages: an EN/FR switch in the header.
//
// The choice is kept in localStorage (ascent-lang, the same key single-player
// uses). A link can also carry ?lang=fr or ?lang=en. Switching reloads the
// page: the server restores the seat, balance and current bet from the
// session token, and every string is drawn fresh in the new language.

import { setLanguage } from "../i18n.js";
import { store } from "./socket.js";

const SUPPORTED = ["en", "fr"];

export async function initLanguage() {
  const url = new URL(location.href);
  const asked = url.searchParams.get("lang");
  if (SUPPORTED.includes(asked)) store.set("ascent-lang", asked);
  const lang = store.get("ascent-lang") === "fr" ? "fr" : "en";
  await setLanguage(lang);
  for (const b of document.querySelectorAll("#langSwitch [data-lang]")) {
    b.setAttribute("aria-pressed", String(b.dataset.lang === lang));
    b.addEventListener("click", () => {
      if (b.dataset.lang === lang) return;
      store.set("ascent-lang", b.dataset.lang);
      url.searchParams.delete("lang"); // the saved choice wins from now on
      location.replace(url.toString());
    });
  }
  return lang;
}
