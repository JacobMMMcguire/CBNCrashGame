// Single-player scene and side panel: astronaut size, name tags, eject travel, and the
// "This launch" / "My flights" panel layout. Bets and cash outs go through the API;
// the pages only show what the server says. Single-player crash points are random
// (provably fair), so steps that need a cash out retry on rounds that crash too early.
import { test, expect, type Browser, type Page } from "@playwright/test";
import { EN, FR, MAIN } from "./helpers";

const SIZES = {
  "1440x900": { viewport: { width: 1440, height: 900 } },
  "1280x720": { viewport: { width: 1280, height: 720 } },
  "360x640": { viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  "390x844": { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
} as const;
type Size = keyof typeof SIZES;

const token = (tag: string) => `guest-${tag.padEnd(8, "0").slice(0, 8)}-1111-4111-8111-${Date.now().toString(16).padStart(12, "0").slice(-12)}`;
async function api(tok: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${MAIN}/api/v1${path}`, {
    ...init, headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  return { status: res.status, body: await res.json() };
}
const setName = (tok: string, name: string) => api(tok, "/account/name", { method: "POST", body: JSON.stringify({ name }) });
const bet = (tok: string, rid: string) => api(tok, `/rounds/${rid}/bets`, {
  method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ wager: "10.00" }) });
const cashOut = (tok: string, rid: string) => api(tok, `/rounds/${rid}/cashout`, {
  method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: "{}" });

async function waitState(tok: string, states: string[], timeoutMs = 30_000) {
  const t0 = Date.now();
  for (;;) {
    const r = (await api(tok, "/rounds/current")).body;
    if (states.includes(r.state)) return r;
    if (Date.now() - t0 > timeoutMs) throw new Error(`round never reached ${states}`);
    await new Promise((res) => setTimeout(res, 80));
  }
}

async function pilotPage(browser: Browser, size: Size, lang: "en" | "fr", tok: string) {
  const ctx = await browser.newContext({ ...SIZES[size] });
  await ctx.addInitScript(([t, l]) => { localStorage.setItem("ascent-guest-token", t); localStorage.setItem("ascent-lang", l); }, [tok, lang]);
  const page = await ctx.newPage();
  await page.goto(`${MAIN}/app/`);
  await expect(page.locator("#balance")).not.toHaveText("–");
  return page;
}

/** Bet with every token in the next round, then cash them all out once it is in flight. Retries early crashes.
 *  A token with an open page bets from that page (its bet button), as a real player does, so the page
 *  knows about its own bet; the others bet through the API. Cash outs go through the API. */
async function everyoneEjects(toks: string[], pages: Record<string, Page> = {}, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const r = await waitState(toks[0], ["betting"]);
    for (const t of toks) {
      const page = pages[t];
      if (!page) { await bet(t, r.roundId); continue; }
      const btn = page.locator("#actionBtn");
      await expect(btn).toHaveAttribute("data-mode", "bet");
      await expect(btn).toBeEnabled();
      await btn.click();
      await expect(page.locator("#posWager")).not.toHaveText("–");
    }
    await waitState(toks[0], ["in-flight", "crashed", "settled"]);
    await new Promise((res) => setTimeout(res, 500)); // let the pages' scenes reach the flight first
    const outs = await Promise.all(toks.map((t) => cashOut(t, r.roundId)));
    if (outs.every((o) => o.status === 200)) return r.roundId;
    await waitState(toks[0], ["settled"]);
  }
  throw new Error("every round crashed before the cash outs");
}

type Box = { x: number; y: number; w: number; h: number; what: string };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

async function panelBoxes(page: Page): Promise<{ shown: boolean; boxes: Box[]; spill: string[] }> {
  return page.evaluate(() => {
    const vis = (el: Element | null) => !!el && (el as HTMLElement).offsetParent !== null && el.getBoundingClientRect().height > 0;
    const box = (el: Element, what: string) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, what }; };
    const roster = document.querySelector(".data__roster");
    const flights = document.querySelector(".data__flights");
    if (!vis(roster)) return { shown: false, boxes: [], spill: [] };
    const boxes = [box(roster!.querySelector(".data__roster-head")!, "this-launch heading")];
    const list = roster!.querySelector("#roster")!.getBoundingClientRect();
    const spill: string[] = [];
    roster!.querySelectorAll("#roster li").forEach((li, i) => {
      const r = li.getBoundingClientRect();
      // a row may scroll inside the list, but must never be painted outside the list's box
      if (r.bottom > list.bottom + 0.5 && getComputedStyle(roster!.querySelector("#roster")!).overflowY === "visible") spill.push(`roster row ${i}`);
      const vTop = Math.max(r.top, list.top), vBottom = Math.min(r.bottom, list.bottom);
      if (vBottom > vTop) boxes.push({ x: r.x, y: vTop, w: r.width, h: vBottom - vTop, what: `live row ${i}` });
    });
    const sectionBottom = roster!.getBoundingClientRect().bottom;
    if (list.bottom > sectionBottom + 0.5) spill.push("roster list below its section");
    if (vis(flights)) {
      boxes.push(box(flights!.querySelector("h3")!, "my-flights heading"));
      const fl = flights!.getBoundingClientRect();
      flights!.querySelectorAll("#flights li").forEach((li, i) => {
        const r = li.getBoundingClientRect();
        const vTop = Math.max(r.top, fl.top), vBottom = Math.min(r.bottom, fl.bottom);
        if (vBottom > vTop) boxes.push({ x: r.x, y: vTop, w: r.width, h: vBottom - vTop, what: `history row ${i}` });
      });
    }
    const fair = document.querySelector("#fairChip");
    if (vis(fair)) boxes.push(box(fair!, "fair chip"));
    return { shown: true, boxes, spill };
  });
}

test.describe.configure({ mode: "serial" });

test("panel: \"This launch\", its live rows and \"My flights\" never overlap (EN/FR, 4 sizes, 0/1/5+ history rows)", async ({ browser }) => {
  test.setTimeout(420_000);
  const viewers = { h0: token("hist0"), h1: token("hist1"), h6: token("hist6") };
  const other = token("othr");
  await setName(other, "WWWWWWWWWWWWWWWW"); // longest, widest allowed name
  // History: h1 rides one round, h6 rides six (every bet rides to the crash).
  for (let i = 0; i < 6; i++) {
    const r = await waitState(viewers.h6, ["betting"]);
    await bet(viewers.h6, r.roundId);
    if (i === 0) await bet(viewers.h1, r.roundId);
    await waitState(viewers.h6, ["settled"]);
  }
  for (const [hist, tok] of Object.entries(viewers)) {
    for (const lang of ["en", "fr"] as const) {
      for (const size of Object.keys(SIZES) as Size[]) {
        // A live round: the other pilot and the viewer both riding.
        const r = await waitState(tok, ["betting"]);
        await bet(other, r.roundId);
        await bet(tok, r.roundId);
        const page = await pilotPage(browser, size, lang, tok);
        const label = `${hist} ${lang} ${size}`;
        const wide = size.startsWith("1");
        if (wide) await expect(page.locator("#roster li"), label).toHaveCount(2);
        const { shown, boxes, spill } = await panelBoxes(page);
        if (!wide) {
          // Phones do not show these sections; the same roster lives in the menu sheet.
          expect(shown, `${label}: desktop panel is hidden on phones`).toBe(false);
          await page.locator("#menuBtn").click();
          const sheet = await page.evaluate(() => {
            const head = document.querySelector("#pilotsSec h3, #pilotsSec .label");
            const rows = [...document.querySelectorAll("#sheetRoster li")].map((li) => li.getBoundingClientRect());
            const h = head?.getBoundingClientRect();
            return { rows: rows.map((r) => [r.top, r.bottom]), head: h ? [h.top, h.bottom] : null };
          });
          for (let i = 1; i < sheet.rows.length; i++) expect(sheet.rows[i][0], `${label}: sheet rows stack`).toBeGreaterThanOrEqual(sheet.rows[i - 1][1] - 0.5);
          await page.context().close();
          continue;
        }
        expect(spill, `${label}: rows painted outside their box`).toEqual([]);
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            expect(overlaps(boxes[i], boxes[j]), `${label}: ${boxes[i].what} overlaps ${boxes[j].what}`).toBe(false);
          }
        }
        // Long names are cut with an ellipsis, not wrapped or spilled.
        const longName = page.locator("#roster .roster__name", { hasText: "WWWW" });
        const cut = await longName.evaluate((el) => ({ over: el.scrollWidth > el.clientWidth, ellipsis: getComputedStyle(el).textOverflow }));
        expect(cut.ellipsis, label).toBe("ellipsis");
        // Headings show the right language.
        await expect(page.locator(".data__roster-head h3"), label).toHaveText((lang === "fr" ? FR : EN)["players.title"]);
        await page.context().close();
      }
    }
  }
});

test("astronauts: every astronaut on a screen is drawn the same size (desktop and phone)", async ({ browser }) => {
  test.setTimeout(180_000);
  const a = token("sizeA"), b = token("sizeB"), c = token("sizeC");
  await setName(a, "Ava"); await setName(b, "Bo"); await setName(c, "Cy");
  const desk = await pilotPage(browser, "1440x900", "en", a);
  const phone = await pilotPage(browser, "390x844", "en", b);
  await everyoneEjects([a, b, c], { [a]: desk, [b]: phone });
  for (const [label, page] of [["desktop", desk], ["phone", phone]] as const) {
    await expect(page.locator(".astro-tag[data-size]"), label).toHaveCount(3, { timeout: 10_000 });
    const sizes = await page.locator(".astro-tag").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.size));
    expect(new Set(sizes).size, `${label}: sizes ${sizes}`).toBe(1);
  }
  // The room host and phone pages draw no astronauts (rooms have no flight scene).
  const host = await browser.newPage();
  await host.goto(`${MAIN}/host`);
  await expect(host.locator("canvas, .astro-tag")).toHaveCount(0);
  for (const p of [desk, phone, host]) await p.context().close();
});

test("name tags: right names, mine marked, long names cut, HTML shown as text", async ({ browser }) => {
  test.setTimeout(180_000);
  const me = token("tagMe"), other = token("tagOt"), long = token("tagLn");
  await setName(other, "Rocket Sam");
  await setName(long, "WWWWWWWWWWWWWWWW");
  const page = await pilotPage(browser, "1440x900", "en", me);
  // The server only accepts plain names; this checks what the page does if a name ever looks like HTML.
  await page.route("**/api/v1/account", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, name: "<b>html</b>" } });
  });
  await page.reload();
  await expect(page.locator("#balance")).not.toHaveText("–");
  await everyoneEjects([me, other, long], { [me]: page });
  const tags = page.locator(".astro-tag[data-size]");
  await expect(tags).toHaveCount(3, { timeout: 10_000 });
  const info = await tags.evaluateAll((els) => els.map((e) => ({
    text: e.textContent, me: e.classList.contains("is-me"), html: e.innerHTML, children: e.children.length,
    cut: e.scrollWidth > e.clientWidth, ellipsis: getComputedStyle(e).textOverflow, w: e.getBoundingClientRect().width,
  })));
  const mine = info.find((t) => t.me)!;
  expect(mine.text).toBe("<b>html</b>");
  expect(mine.children).toBe(0);
  expect(mine.html).toBe("&lt;b&gt;html&lt;/b&gt;");
  expect(info.filter((t) => t.me)).toHaveLength(1);
  expect(info.map((t) => t.text).sort()).toEqual(["<b>html</b>", "Rocket Sam", "WWWWWWWWWWWWWWWW"].sort());
  const longTag = info.find((t) => t.text === "WWWWWWWWWWWWWWWW")!;
  expect(longTag.cut && longTag.ellipsis === "ellipsis" && longTag.w <= 120.5).toBe(true);
  // Tags do not cover each other and stay inside the stage.
  const rects = await tags.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  const stage = (await page.locator(".stage").boundingBox())!;
  for (const r of rects) expect(r.left >= stage.x - 0.5 && r.right <= stage.x + stage.width + 0.5 && r.top >= stage.y - 0.5).toBe(true);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    expect(a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom, "tags overlap").toBe(false);
  }
  await page.context().close();
});

for (const size of ["360x640", "1440x900"] as const) {
  test(`eject travel stays inside the stage at ${size}`, async ({ browser }) => {
    test.setTimeout(180_000);
    const toks = [token("ejA"), token("ejB"), token("ejC"), token("ejD")];
    for (const [i, t] of toks.entries()) await setName(t, `Pilot ${i + 1}`);
    const page = await pilotPage(browser, size, "en", toks[0]);
    await everyoneEjects(toks, { [toks[0]]: page });
    await expect(page.locator(".astro-tag[data-size]")).toHaveCount(4, { timeout: 10_000 });
    const stage = (await page.locator(".stage__sky").boundingBox())!;
    let minX = Infinity, maxX = -Infinity, half = 0;
    for (let i = 0; i < 25; i++) { // sample the drift for 2.5 s
      const xs = await page.locator(".astro-tag[data-ax]").evaluateAll((els) =>
        els.map((e) => [Number((e as HTMLElement).dataset.ax), Number((e as HTMLElement).dataset.size)]));
      for (const [x, s] of xs) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); half = s / 2; }
      await page.waitForTimeout(100);
    }
    expect(minX, "left edge").toBeGreaterThanOrEqual(half - 0.5);
    expect(maxX, "right edge").toBeLessThanOrEqual(stage.width - half + 0.5);
    expect(stage.x + stage.width, "stage inside the viewport").toBeLessThanOrEqual(page.viewportSize()!.width + 0.5);
    expect(maxX - minX, "astronauts actually drift sideways").toBeGreaterThan(20);
    await page.context().close();
  });
}
