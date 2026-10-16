// End-to-end: one host screen and two phones play a multiplayer room in Edge.
//
// The flow is one stateful story, so it is one test made of named steps. The
// server runs the fast e2e config (2.5 s betting, growthRate 0.3) and the
// SKELETON crash list, so a new room's first round crashes at 1.84x.
import { test, expect, devices, type Browser, type Page } from "@playwright/test";

const PHONE = devices["Pixel 7"]; // phone viewport, isMobile, hasTouch

const pages: Record<string, Page> = {};
const pageErrors: string[] = [];

async function newPage(browser: Browser, name: string, options = {}): Promise<Page> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on("pageerror", (err) => pageErrors.push(`${name}: ${err.message}`));
  pages[name] = page;
  return page;
}

const phone = (browser: Browser, name: string) => newPage(browser, name, { ...PHONE });

/** "1,082.10" -> 108210 units */
const units = (text: string) => Math.round(Number(text.replace(/[^\d.]/g, "")) * 100);
const ranks = (page: Page) => page.locator(".lb-row .lb-row__rank").allTextContents();
const names = (page: Page) => page.locator(".lb-row .lb-row__name").allTextContents();
const balances = (page: Page) => page.locator(".lb-row .lb-row__bal").allTextContents();

async function join(page: Page, name: string) {
  await page.locator("#nameInput").fill(name);
  await page.locator("#joinBtn").tap();
}

// On failure the config keeps a trace and a screenshot of every context.
test.afterEach(async () => {
  for (const page of Object.values(pages)) await page.context().close();
  for (const name of Object.keys(pages)) delete pages[name];
  pageErrors.length = 0;
});

test("host, two phones: join, play, leaderboard, reconnect, kick, invented token", async ({ browser, baseURL }) => {
  const host = await newPage(browser, "host", { viewport: { width: 1440, height: 900 } });
  let code = "";
  let joinLink = "";

  await test.step("host creates a room; QR code and room code appear", async () => {
    await host.goto("/host");
    await host.getByRole("button", { name: "Host a game" }).click();
    await expect(host.locator("#conn")).toHaveAttribute("data-status", "open");
    await expect(host.locator("#roomCode")).toHaveText(/^[A-Z2-9]{4}$/);
    code = (await host.locator("#roomCode").textContent())!;
    joinLink = (await host.locator("#joinUrl").textContent())!;
    expect(joinLink).toBe(`${baseURL}/join/${code}`);
    await expect(host).toHaveURL(`${baseURL}/host?room=${code}`);
    const qr = host.locator("#qr svg");
    await expect(qr).toBeVisible();
    await expect(qr).toHaveAttribute("aria-label", `QR code to join room ${code}`);
    expect((await qr.locator("path").getAttribute("d"))!.length).toBeGreaterThan(500);
    // The test server uses PUBLIC_BASE_URL=127.0.0.1, which phones could not reach: the warning must show.
    await expect(host.locator("#localWarn")).toBeVisible();
  });

  const ana = await phone(browser, "ana");
  const ben = await phone(browser, "ben");

  await test.step("both players join via the join link; a duplicate name is rejected", async () => {
    await ana.goto(joinLink);
    await expect(ana.locator("#startingNote")).toContainText("1,000.00 play credits");
    await join(ana, "Ana");
    await expect(ana.locator("#meName")).toHaveText("Ana");
    await expect(ana.locator("#meBalance")).toHaveText("1,000.00");
    await expect(ana.locator(".playmoney")).toBeVisible();

    await ben.goto(joinLink);
    await join(ben, "  ana ");
    await expect(ben.locator("#joinError")).toHaveText("Someone in this room already has that name. Pick another.");
    await expect(ben.locator("#play")).toBeHidden();
    await join(ben, "Ben");
    await expect(ben.locator("#meName")).toHaveText("Ben");

    await expect(host.locator("#playerCount")).toHaveText("(2)");
    await expect(host.locator(".lobby-item")).toHaveText([/Ana\s*online/, /Ben\s*online/]);
  });

  await test.step("tied players share rank 1 on host and phones", async () => {
    for (const page of [host, ana, ben]) {
      await expect.poll(() => ranks(page)).toEqual(["1", "1"]);
      await expect.poll(() => balances(page)).toEqual(["1,000.00", "1,000.00"]);
    }
    await expect(ana.locator('.lb-row[data-me="true"]')).toHaveText(/Ana \(you\)/);
    await expect(ben.locator('.lb-row[data-me="true"]')).toHaveText(/Ben \(you\)/);
    await expect(host.locator('.lb-row[data-me="true"]')).toHaveCount(0);
  });

  let payoutUnits = 0;

  await test.step("host starts; both bet 10.00; Ana cashes out; Ben rides to the crash", async () => {
    await host.locator("#startBtn").click();
    await expect(host.locator("#startBtn")).toHaveText("Game running");
    for (const p of [ana, ben]) {
      await expect(p.locator("#stage")).toHaveAttribute("data-state", "betting");
      await expect(p.locator("#actionBtn")).toHaveText("Place bet · 10.00 play credits");
      await p.locator("#actionBtn").tap();
      await expect(p.locator("#meBalance")).toHaveText("990.00");
    }
    // Cash out as soon as the server's multiplier passes 1.20x (this round crashes at 1.84x).
    await expect(ana.locator("#actionBtn")).toHaveAttribute("data-mode", "cashout", { timeout: 15_000 });
    await ana.waitForFunction(
      () => parseFloat(document.querySelector("#stage [data-multiplier]")!.textContent!) >= 1.2,
      undefined, { polling: "raf" });
    await ana.locator("#actionBtn").tap();
    const result = ana.locator("#result");
    await expect(result).toHaveText(/^Cashed out at \d\.\d\d×: \+\d+\.\d\d play credits$/);
    const [, mult, payout] = (await result.textContent())!.match(/at (\d\.\d\d)×: \+([\d.]+)/)!;
    const hundredths = Math.round(Number(mult) * 100);
    expect(hundredths).toBeGreaterThanOrEqual(120);
    expect(hundredths).toBeLessThan(184);
    payoutUnits = Math.floor((1000 * hundredths) / 100); // floor(wager x multiplier), wager 10.00 = 1000 units
    expect(units(payout)).toBe(payoutUnits);
    await expect.poll(async () => units((await ana.locator("#meBalance").textContent())!)).toBe(99000 + payoutUnits);

    await expect(ben.locator("#result")).toHaveText("Crashed at 1.84×. You lost 10.00 play credits.", { timeout: 15_000 });
    await expect(ben.locator("#meBalance")).toHaveText("990.00");
  });

  await test.step("after settle the leaderboard ranks Ana 1, Ben 2 everywhere", async () => {
    const anaBalance = ((99000 + payoutUnits) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2 });
    for (const page of [host, ana, ben]) {
      await expect.poll(() => ranks(page), { timeout: 15_000 }).toEqual(["1", "2"]);
      await expect.poll(() => balances(page)).toEqual([anaBalance, "990.00"]);
    }
    expect(await names(host)).toEqual(["Ana", "Ben"]);
    expect(await names(ana)).toEqual(["Ana (you)", "Ben"]);
    expect(await names(ben)).toEqual(["Ana", "Ben (you)"]);
  });

  await test.step("Ana reloads and reconnects with the same balance", async () => {
    const before = await ana.locator("#meBalance").textContent();
    await ana.reload();
    await expect(ana.locator("#play")).toBeVisible();
    await expect(ana.locator("#nameForm")).toBeHidden();
    await expect(ana.locator("#meName")).toHaveText("Ana");
    await expect(ana.locator("#meBalance")).toHaveText(before!);
    await expect(host.locator(".lobby-item").first()).toHaveText(/Ana\s*online/);
  });

  await test.step("host kicks Ben", async () => {
    host.once("dialog", (d) => d.accept());
    await host.locator(".lobby-item", { hasText: "Ben" }).getByRole("button", { name: "Remove Ben" }).click();
    await expect(ben.locator("#noticeText")).toHaveText("The host removed you from this room.");
    await expect(ben.locator("#play")).toBeHidden();
    await expect(host.locator("#playerCount")).toHaveText("(1)");
    await expect.poll(() => names(host)).toEqual(["Ana"]);
    expect(await ben.evaluate((c) => localStorage.getItem(`ascent-session:${c}`), code)).toBeNull();
  });

  await test.step("a phone with an invented session token is refused", async () => {
    const mallory = await phone(browser, "mallory");
    await mallory.addInitScript(([c]) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem(`ascent-session:${c}`, "invented-token-0123456789abcdefghijklmnop");
        sessionStorage.setItem("seeded", "1");
      }
    }, [code]);
    await mallory.goto(joinLink);
    await expect(mallory.locator("#nameForm")).toBeVisible();
    await expect(mallory.locator("#joinError")).toHaveText("This device is not in the room right now. Enter a name to join.");
    await expect(mallory.locator("#play")).toBeHidden();
    expect(await mallory.evaluate((c) => localStorage.getItem(`ascent-session:${c}`), code)).toBeNull();
    await expect(host.locator("#playerCount")).toHaveText("(1)");
  });

  expect(pageErrors, "uncaught errors in the pages").toEqual([]);
});
