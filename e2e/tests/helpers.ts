// Shared helpers for the e2e suites: room API calls, a small WebSocket client
// (Node 20+ has a global WebSocket) and an in-page layout/i18n audit.
import { type Browser, type Page, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export const MAIN = "http://127.0.0.1:8799";
export const LAN = "http://127.0.0.1:8798"; // its PUBLIC_BASE_URL is http://192.168.50.10:8798
export const LAN_PUBLIC = "http://192.168.50.10:8798";
export const SHOTS = path.join(__dirname, "..", "screenshots");

const locales = path.join(__dirname, "..", "..", "frontend", "locales");
export const EN: Record<string, string> = JSON.parse(fs.readFileSync(path.join(locales, "en.json"), "utf-8"));
export const FR: Record<string, string> = JSON.parse(fs.readFileSync(path.join(locales, "fr.json"), "utf-8"));

export const VIEWPORTS = {
  "360x640": { viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  "390x844": { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  "1440x900": { viewport: { width: 1440, height: 900 } },
} as const;
export type ViewportName = keyof typeof VIEWPORTS;

// ---------- API ----------

export async function createRoom(base: string): Promise<{ roomCode: string; hostToken: string; publicBaseUrl: string }> {
  const res = await fetch(`${base}/api/v1/rooms`, { method: "POST" });
  expect(res.status).toBe(201);
  return res.json();
}

export async function joinRoom(base: string, code: string, name: string) {
  const res = await fetch(`${base}/api/v1/rooms/${code}/players`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
  });
  return { status: res.status, body: await res.json() };
}

/** A room socket driven from the test process (host or player). */
export class RoomClient {
  messages: any[] = [];
  private ws!: WebSocket;
  private waiters: { pred: (m: any) => boolean; resolve: (m: any) => void }[] = [];
  private nextRef = 1;

  static async open(base: string, code: string, role: "host" | "player", token: string): Promise<RoomClient> {
    const c = new RoomClient();
    c.ws = new WebSocket(`${base.replace("http", "ws")}/api/v1/rooms/${code}/ws`);
    c.ws.onmessage = (e) => c.onMessage(JSON.parse(String(e.data)));
    await new Promise<void>((resolve, reject) => {
      c.ws.onopen = () => resolve();
      c.ws.onerror = () => reject(new Error("socket error"));
    });
    c.ws.send(JSON.stringify({ type: "hello", role, token }));
    await c.waitFor((m) => m.type === "welcome");
    return c;
  }

  private onMessage(m: any) {
    this.messages.push(m);
    for (const w of [...this.waiters]) {
      if (w.pred(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(m); }
    }
  }

  waitFor(pred: (m: any) => boolean, timeoutMs = 20_000): Promise<any> {
    const seen = this.messages.find(pred);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timed out waiting for a message")), timeoutMs);
      this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  }

  /** Wait for a message that arrives after this call. */
  next(pred: (m: any) => boolean, timeoutMs = 20_000): Promise<any> {
    const already = this.messages.length;
    return this.waitFor((m) => this.messages.indexOf(m) >= already && pred(m), timeoutMs);
  }

  async act(type: string, fields: Record<string, unknown> = {}): Promise<any> {
    const ref = String(this.nextRef++);
    const reply = this.waitFor((m) => m.type === "reply" && m.data.ref === ref);
    this.ws.send(JSON.stringify({ type, ref, ...fields }));
    return (await reply).data;
  }

  close() { this.ws.close(); }
}

// ---------- Pages ----------

export async function newPage(browser: Browser, vp: ViewportName, lang: "en" | "fr", storage: Record<string, string> = {}) {
  const context = await browser.newContext({ ...VIEWPORTS[vp] });
  await context.addInitScript(([l, s]) => {
    // Seed once per tab so the page's own changes (e.g. a removed token) survive reloads.
    if (sessionStorage.getItem("e2e-seeded")) return;
    localStorage.setItem("ascent-lang", l as string);
    for (const [k, v] of Object.entries(s as Record<string, string>)) localStorage.setItem(k, v);
    sessionStorage.setItem("e2e-seeded", "1");
  }, [lang, storage] as const);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { page, errors };
}

export async function shot(page: Page, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

// ---------- Audit ----------

export type Problem = { kind: string; where: string; detail?: string };

/** Measure the page as rendered: overflow, clipping, overlaps, tap targets, contrast, untranslated text. */
export async function audit(page: Page, lang: "en" | "fr"): Promise<Problem[]> {
  const english = lang === "fr"
    ? Object.keys(EN).filter((k) => EN[k] !== FR[k]).map((k) => longestFixedPart(EN[k])).filter((s) => s.length >= 6)
    : [];
  // Audit the screen as a player first sees it: scrolled to the top.
  await page.evaluate(() => window.scrollTo(0, 0));
  return page.evaluate(({ english, touch }) => {
    const problems: { kind: string; where: string; detail?: string }[] = [];
    const vw = document.documentElement.clientWidth;
    const where = (el: Element) => {
      const id = el.id ? `#${el.id}` : "";
      const cls = el.classList.length ? "." + [...el.classList].join(".") : "";
      return `${el.tagName.toLowerCase()}${id}${cls} "${(el.textContent || "").trim().slice(0, 40)}"`;
    };
    const shown = (el: Element) => {
      if (el.closest("[hidden]")) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0;
    };
    if (document.documentElement.scrollWidth > vw + 1) {
      problems.push({ kind: "horizontal-scroll", where: "page", detail: `${document.documentElement.scrollWidth}px > ${vw}px` });
    }
    const all = [...document.querySelectorAll("body *")].filter(shown);
    const leaves = all.filter((el) => !el.children.length && (el.textContent || "").trim());
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) problems.push({ kind: "off-screen", where: where(el), detail: `${Math.round(r.left)}..${Math.round(r.right)} of ${vw}` });
    }
    for (const el of leaves) {
      const cs = getComputedStyle(el as HTMLElement);
      const h = el as HTMLElement;
      if (h.clientWidth && h.scrollWidth > h.clientWidth + 1) {
        problems.push({ kind: cs.textOverflow === "ellipsis" ? "truncated" : "text-overflow", where: where(el) });
      }
    }
    // Overlaps between text/controls that are not nested in each other.
    const boxes = [...leaves, ...all.filter((el) => el.matches("button, input, .chip, .qr"))]
      .filter((el, i, arr) => arr.indexOf(el) === i);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const hgt = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (w > 2 && hgt > 2) problems.push({ kind: "overlap", where: `${where(a)} / ${where(b)}` });
      }
    }
    if (touch) {
      for (const el of all.filter((e) => e.matches("button, a.btn, input, .chip"))) {
        const r = el.getBoundingClientRect();
        if (r.height < 44 || r.width < 44) problems.push({ kind: "small-target", where: where(el), detail: `${Math.round(r.width)}x${Math.round(r.height)}` });
      }
    }
    // Contrast (WCAG 2): text colour against the first opaque background behind it.
    const rgb = (s: string) => (s.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = (el: Element | null): number[] => {
      for (; el; el = el.parentElement) {
        const c = rgb(getComputedStyle(el).backgroundColor);
        if (c.length >= 3 && (c.length < 4 || c[3] > 0.9)) return c.slice(0, 3);
      }
      return [255, 255, 255];
    };
    for (const el of leaves) {
      if (el.closest("button:disabled")) continue; // disabled controls are exempt in WCAG
      const cs = getComputedStyle(el);
      const fg = rgb(cs.color).slice(0, 3), bg = bgOf(el);
      const [l1, l2] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
      const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      if (ratio < need) problems.push({ kind: "contrast", where: where(el), detail: `${ratio.toFixed(2)} < ${need}` });
    }
    // Text that should have been translated, and raw catalog keys.
    const text = document.body.innerText + "\n" + [...document.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label")).join("\n");
    for (const s of english) if (text.includes(s)) problems.push({ kind: "untranslated", where: "page", detail: s });
    const keys = text.match(/\b(room|conn|unit|header|status|phase)\.[a-z][A-Za-z.]+/g);
    if (keys) problems.push({ kind: "raw-key", where: "page", detail: keys.join(", ") });
    return problems;
  }, { english, touch: lang && (page.viewportSize()?.width ?? 1000) < 500 });
}

function longestFixedPart(s: string): string {
  return s.split(/\{[^}]+\}/).map((p) => p.trim()).sort((a, b) => b.length - a.length)[0] || "";
}
