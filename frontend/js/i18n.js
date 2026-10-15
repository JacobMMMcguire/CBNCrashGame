// String catalog and number formatting. Strings live in locales/<lang>.json.
// Markup uses data-i18n="key" (text) and data-i18n-attr="attr:key;attr2:key2".

const LOCALE_TAGS = { en: "en-CA", fr: "fr-CA" };
const catalogs = {};
let lang = "en";

async function loadCatalog(code) {
  if (!catalogs[code]) {
    const res = await fetch(new URL(`../locales/${code}.json`, import.meta.url));
    if (!res.ok) throw new Error(`locale ${code}: HTTP ${res.status}`);
    catalogs[code] = await res.json();
  }
  return catalogs[code];
}

export async function setLanguage(code) {
  await loadCatalog("en"); // fallback for missing keys
  await loadCatalog(code);
  lang = code;
  document.documentElement.lang = LOCALE_TAGS[code] || code;
  applyI18n();
}

export const currentLanguage = () => lang;

export function t(key, vars) {
  let s = catalogs[lang]?.[key] ?? catalogs.en?.[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

export function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    for (const pair of el.dataset.i18nAttr.split(";")) {
      const [attr, key] = pair.split(":");
      el.setAttribute(attr, t(key));
    }
  });
}

const numberFormat = (digits) =>
  new Intl.NumberFormat(LOCALE_TAGS[lang] || lang, { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** "1150.00" (API credit string) -> "1,150.00" (en) or "1 150,00" (fr). */
export function formatCredits(value) {
  if (value === null || value === undefined || value === "") return "–";
  return numberFormat(2).format(Number(value));
}

/** Plain number with up to two decimals, for chips: "10", "1 000". */
export function formatNumber(value) {
  return new Intl.NumberFormat(LOCALE_TAGS[lang] || lang, { maximumFractionDigits: 2 }).format(Number(value));
}

/** 2.47 -> "2.47×" (en) or "2,47×" (fr). The server already floored it. */
export function formatMultiplier(value) {
  return numberFormat(2).format(value) + "×";
}

/**
 * Parse what a player typed ("100", "100.5", "100,50") into an API credit
 * string with exactly two decimals ("100.50"), or null if it is not a number.
 * Works on the string so no floating-point rounding is involved.
 */
export function parseCreditsInput(text) {
  const m = String(text).trim().replace(/[\s  ]/g, "").match(/^(\d{1,9})(?:[.,](\d{0,2}))?$/);
  if (!m) return null;
  return `${Number(m[1])}.${(m[2] || "").padEnd(2, "0")}`;
}

/** Parse a typed multiplier ("2", "2,5") into a number with two decimals, or null. */
export function parseMultiplierInput(text) {
  const credits = parseCreditsInput(text);
  return credits === null ? null : Number(credits);
}

/** Countdown seconds with one decimal: "4.2 s" (en) or "4,2 s" (fr). */
export function formatSeconds(value) {
  return t("read.seconds", { s: numberFormat(1).format(Math.max(0, value)) });
}

/** 0.485 -> "48.5%" (en) or "48,5 %" (fr). */
export function formatPercent(value) {
  return new Intl.NumberFormat(LOCALE_TAGS[lang] || lang, { style: "percent", maximumFractionDigits: 2 }).format(value);
}
