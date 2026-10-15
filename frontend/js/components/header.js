// Header: balance, connection status, language and theme toggles.

import { formatCredits, t } from "../i18n.js";
import { setText } from "../store.js";

export function mountHeader(store, actions) {
  const balance = document.getElementById("balance");
  const conn = document.getElementById("conn");
  const connText = document.getElementById("connText");
  const langSwitch = document.getElementById("langSwitch");
  const themeButtons = document.querySelectorAll("[data-theme-set]");

  const langs = store.get().config.supportedLanguages;
  langSwitch.replaceChildren(...langs.map((code) => {
    const b = document.createElement("button");
    b.type = "button";
    b.lang = code;
    b.dataset.lang = code;
    b.title = t(`lang.${code}`);
    b.textContent = code.toUpperCase();
    b.addEventListener("click", () => actions.setLanguage(code));
    return b;
  }));
  themeButtons.forEach((b) => b.addEventListener("click", () => actions.setTheme(b.dataset.themeSet)));

  store.subscribe((s) => {
    setText(balance, formatCredits(s.balance));
    conn.dataset.status = s.connection;
    setText(connText, t(`conn.${s.connection}`));
    langSwitch.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === s.lang)));
    themeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeSet === s.theme)));
  });
}
