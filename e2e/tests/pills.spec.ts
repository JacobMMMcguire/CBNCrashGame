// The "Recent launches" pill row must never make the single-player page wider than the
// screen. The page's round history is fed through network routing so the pill count is
// exact (0, 7 or 32 rounds; the page draws at most 24 pills).
import { test, expect } from "@playwright/test";
import { MAIN } from "./helpers";

const SIZES = {
  "360x640": { viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  "390x844": { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  "1280x720": { viewport: { width: 1280, height: 720 } },
  "1440x900": { viewport: { width: 1440, height: 900 } },
} as const;

const history = (n: number) => ({
  rounds: Array.from({ length: n }, (_, i) => ({ roundId: `r_${9000 - i}`, crash: [1.84, 12.4, 3.12, 1.0, 2.47, 105.5][i % 6], myResult: null })),
});

for (const pills of [0, 7, 32]) {
  for (const lang of ["en", "fr"] as const) {
    for (const [size, opts] of Object.entries(SIZES)) {
      test(`no sideways scroll: ${pills} rounds of history, ${lang}, ${size}`, async ({ browser }) => {
        const ctx = await browser.newContext({ ...opts });
        await ctx.addInitScript((l) => localStorage.setItem("ascent-lang", l), lang);
        const page = await ctx.newPage();
        await page.route("**/api/v1/history*", (route) => route.fulfill({ json: history(pills) }));
        await page.goto(`${MAIN}/app/`);
        await expect(page.locator("#balance")).not.toHaveText("–");
        // A live round may finish during the test and add one more pill.
        if (pills) await expect.poll(() => page.locator("#pills .pill").count()).toBeGreaterThanOrEqual(Math.min(pills, 24));
        expect(await page.locator("#pills .pill").count()).toBeLessThanOrEqual(24);
        const m = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const cards = [...document.querySelectorAll("#position .stat")].map((e) => e.getBoundingClientRect());
          const row = document.querySelector("#pills")!.getBoundingClientRect();
          return {
            vw, docW: document.documentElement.scrollWidth, bodyW: document.body.scrollWidth,
            cards: cards.map((r) => [Math.round(r.left), Math.round(r.right), Math.round(r.width)]),
            pillsRight: Math.round(row.right),
          };
        });
        const label = `${pills} pills ${lang} ${size}`;
        expect(m.docW, `${label}: document width`).toBe(m.vw);
        expect(m.bodyW, `${label}: body width`).toBeLessThanOrEqual(m.vw);
        expect(m.pillsRight, `${label}: pill row stays on screen`).toBeLessThanOrEqual(m.vw);
        // The wager / multiplier / payout cards are all on screen and share the row evenly.
        for (const [left, right] of m.cards) expect(left >= 0 && right <= m.vw, `${label}: card ${left}-${right}`).toBe(true);
        const widths = m.cards.map((c) => c[2]);
        expect(Math.max(...widths) - Math.min(...widths), `${label}: card widths ${widths}`).toBeLessThanOrEqual(1);
        if (size.startsWith("3")) expect(Math.max(...widths), `${label}: phone card width`).toBeLessThan(m.vw / 3);
        await ctx.close();
      });
    }
  }
}
