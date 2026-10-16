// Review suite: feature checks the main flow does not cover, plus a layout and
// translation sweep that saves screenshots to e2e/screenshots/ and audits every
// screen (EN and FR, 360x640, 390x844, 1440x900).
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  EN, FR, LAN, LAN_PUBLIC, MAIN, SHOTS, VIEWPORTS, type Problem, type ViewportName,
  audit, createRoom, joinRoom, newPage, RoomClient, shot,
} from "./helpers";

const ranks = (p: Page) => p.locator(".lb-row .lb-row__rank").allTextContents();
const names = (p: Page) => p.locator(".lb-row .lb-row__name").allTextContents();
const balances = (p: Page) => p.locator(".lb-row .lb-row__bal").allTextContents();

// Problems that must never appear. "truncated" (deliberate ellipsis on long names) is reported, not failed.
const HARD = new Set(["horizontal-scroll", "off-screen", "text-overflow", "overlap", "small-target", "contrast", "untranslated", "raw-key"]);

// Tests run in file order (one worker); a failure does not skip the rest of the sweep.

test("locale catalogs have the same keys and no empty strings", () => {
  expect(Object.keys(FR).sort()).toEqual(Object.keys(EN).sort());
  for (const [k, v] of Object.entries(FR)) expect(v.trim(), k).not.toBe("");
});

test("leaderboard: ties share ranks 1,2,2,4; updates on kick and join; own row highlighted", async ({ browser }) => {
  const room = await createRoom(LAN);
  const code = room.roomCode;
  const host = await RoomClient.open(LAN, code, "host", room.hostToken);
  const p: Record<string, any> = {};
  for (const n of ["Ava", "Bea", "Cy", "Dee"]) p[n] = (await joinRoom(LAN, code, n)).body;
  const sock: Record<string, RoomClient> = {};
  for (const n of ["Bea", "Cy", "Dee"]) sock[n] = await RoomClient.open(LAN, code, "player", p[n].sessionToken);

  expect((await host.act("start")).status).toBe(200);
  const betting = await sock.Bea.waitFor((m) => m.type === "round.betting");
  const rid = betting.roundId;
  for (const [n, wager] of [["Bea", "10.00"], ["Cy", "10.00"], ["Dee", "50.00"]] as const) {
    const r = await sock[n].act("place_bet", { roundId: rid, wager, idempotencyKey: crypto.randomUUID() });
    expect(r.status, n).toBe(201);
  }
  // Ava did not bet. Nobody cashes out: the round crashes at 1.84x and all three bets are lost.
  const board = await host.waitFor((m) => m.type === "leaderboard.updated" && m.data.afterRoundId === rid);
  expect(board.data.entries.map((e: any) => [e.rank, e.name, e.balance])).toEqual([
    [1, "Ava", "1000.00"], [2, "Bea", "990.00"], [2, "Cy", "990.00"], [4, "Dee", "950.00"],
  ]);

  const { page: hostPage } = await newPage(browser, "1440x900", "en", { [`ascent-host:${code}`]: room.hostToken });
  await hostPage.goto(`${LAN}/host?room=${code}`);
  await expect.poll(() => ranks(hostPage)).toEqual(["1", "2", "2", "4"]);
  expect(await names(hostPage)).toEqual(["Ava", "Bea", "Cy", "Dee"]);
  expect(await balances(hostPage)).toEqual(["1,000.00", "990.00", "990.00", "950.00"]);
  const bigRow = await hostPage.locator(".lb-row").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(bigRow).toBeGreaterThanOrEqual(20); // large board on the host screen

  const { page: cy } = await newPage(browser, "390x844", "en", { [`ascent-session:${code}`]: p.Cy.sessionToken });
  await cy.goto(`${LAN}/join/${code}`);
  await expect.poll(() => ranks(cy)).toEqual(["1", "2", "2", "4"]);
  await expect(cy.locator('.lb-row[data-me="true"]')).toHaveText(/^2\s*Cy \(you\)\s*990\.00$/);
  await expect(cy.locator('.lb-row[data-me="true"]')).toHaveCount(1);
  const rowFont = await cy.locator(".lb-row").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(rowFont).toBeLessThan(bigRow); // compact on the phone

  // Kick updates the board everywhere.
  hostPage.once("dialog", (d) => d.accept());
  await hostPage.getByRole("button", { name: "Remove Dee" }).click();
  await expect.poll(() => ranks(cy)).toEqual(["1", "2", "2"]);
  await expect.poll(() => names(hostPage)).toEqual(["Ava", "Bea", "Cy"]);

  // A newcomer enters with the starting balance, after the player already holding it.
  await joinRoom(LAN, code, "Eve");
  await expect.poll(() => names(hostPage)).toEqual(["Ava", "Eve", "Bea", "Cy"]);
  expect(await ranks(hostPage)).toEqual(["1", "1", "3", "3"]);
  await expect.poll(() => names(cy)).toEqual(["Ava", "Eve", "Bea", "Cy (you)"]);

  for (const c of [host, ...Object.values(sock)]) c.close();
  await hostPage.context().close();
  await cy.context().close();
});

test("QR: link uses PUBLIC_BASE_URL, QR encodes exactly that link, code shown, no localhost warning", async ({ browser }) => {
  const room = await createRoom(LAN);
  expect(room.publicBaseUrl).toBe(LAN_PUBLIC);
  const { page } = await newPage(browser, "1440x900", "en", { [`ascent-host:${room.roomCode}`]: room.hostToken });
  await page.goto(`${LAN}/host?room=${room.roomCode}`);
  const link = `${LAN_PUBLIC}/join/${room.roomCode}`;
  await expect(page.locator("#joinUrl")).toHaveText(link);
  await expect(page.locator("#roomCode")).toHaveText(room.roomCode);
  await expect(page.locator("#localWarn")).toBeHidden();
  // The drawn modules must be exactly the encoder's output for the link (decoding is checked separately).
  const same = await page.evaluate((url) => {
    const qr = (window as any).qrcode(0, "M");
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
    return document.querySelector("#qr path")!.getAttribute("d") === d;
  }, link);
  expect(same).toBe(true);
  // The code sits under the QR code.
  const qrBox = (await page.locator("#qr").boundingBox())!;
  const codeBox = (await page.locator("#roomCode").boundingBox())!;
  expect(codeBox.y).toBeGreaterThan(qrBox.y + qrBox.height - 1);
  await page.context().close();
});

test("names: spaced names are tidied, duplicates refused, blank names get a message", async ({ browser }) => {
  const room = await createRoom(MAIN);
  const code = room.roomCode;
  const { page: a } = await newPage(browser, "390x844", "en");
  await a.goto(`${MAIN}/join/${code}`);
  await a.locator("#nameInput").fill("   Ana    Lee  ");
  await a.locator("#joinBtn").tap();
  await expect(a.locator("#meName")).toHaveText("Ana Lee");
  const { page: b } = await newPage(browser, "390x844", "en");
  await b.goto(`${MAIN}/join/${code}`);
  await b.locator("#nameInput").fill("ANA LEE");
  await b.locator("#joinBtn").tap();
  await expect(b.locator("#joinError")).toHaveText(EN["room.error.NAME_TAKEN"]);
  await b.locator("#nameInput").fill("    ");
  await b.locator("#joinBtn").tap();
  await expect(b.locator("#joinError")).toHaveText(EN["room.join.nameRequired"]);
  await expect(b.locator("#nameInput")).toHaveAttribute("maxlength", "16");
  await a.context().close();
  await b.context().close();
});

test("language switch on room pages: FR keeps the seat; ?lang= links work", async ({ browser }) => {
  const room = await createRoom(LAN);
  const ana = (await joinRoom(LAN, room.roomCode, "Ana")).body;
  const { page, errors } = await newPage(browser, "360x640", "en", { [`ascent-session:${room.roomCode}`]: ana.sessionToken });
  await page.goto(`${LAN}/join/${room.roomCode}`);
  await expect(page.locator("#meBalance")).toHaveText("1,000.00");
  await expect(page.locator('#langSwitch [data-lang="en"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('#langSwitch [data-lang="fr"]').tap();
  await expect(page.locator('#langSwitch [data-lang="fr"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".playmoney")).toHaveText(FR["room.playMoney"]);
  await expect(page.locator("#meName")).toHaveText("Ana"); // same seat after the reload
  await expect(page.locator("#meBalance")).toHaveText(/^1\s000,00$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "fr-CA");

  const host = await newPage(browser, "1440x900", "fr", { [`ascent-host:${room.roomCode}`]: room.hostToken });
  await host.page.goto(`${LAN}/host?room=${room.roomCode}&lang=en`);
  await expect(host.page.locator("#startBtn")).toHaveText(EN["room.host.start"]);
  await expect(host.page.locator('#langSwitch [data-lang="en"]')).toHaveAttribute("aria-pressed", "true");
  expect(errors.concat(host.errors)).toEqual([]);
  await page.context().close();
  await host.page.context().close();
});

test("a silently dropped connection is noticed within 25 s and the phone reconnects", async ({ browser }) => {
  const room = await createRoom(LAN);
  const ana = (await joinRoom(LAN, room.roomCode, "Ana")).body;
  const { page } = await newPage(browser, "390x844", "en", { [`ascent-session:${room.roomCode}`]: ana.sessionToken });
  await page.clock.install();
  // Sit between the page and the server; "muted" swallows everything the server sends,
  // like a Wi-Fi link that died without closing the socket.
  let muted = false;
  await page.routeWebSocket(/\/api\/v1\/rooms\/.*\/ws$/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => { if (!muted) ws.send(m); });
  });
  await page.goto(`${LAN}/join/${room.roomCode}`);
  await expect(page.locator("#conn")).toHaveAttribute("data-status", "open");
  muted = true;
  await page.clock.fastForward(20_000);
  await expect(page.locator("#conn")).toHaveAttribute("data-status", "open"); // under 25 s: still trusted
  await page.clock.fastForward(10_000);
  await expect(page.locator("#conn")).toHaveAttribute("data-status", "reconnecting");
  muted = false;
  await page.clock.fastForward(3_000);
  await expect(page.locator("#conn")).toHaveAttribute("data-status", "open");
  await expect(page.locator("#meName")).toHaveText("Ana");
  await page.context().close();
});

test("single-player /app/ still plays a round", async ({ browser }) => {
  for (const lang of ["en", "fr"] as const) {
    const { page, errors } = await newPage(browser, "1440x900", lang);
    await page.goto(`${MAIN}/app/`);
    await expect(page.locator("#conn")).toHaveAttribute("data-status", "open");
    const before = await page.locator("#balance").textContent();
    await expect(page.locator("#betBtn")).toBeEnabled({ timeout: 20_000 });
    await page.locator("#wager").fill("10");
    await page.locator("#betBtn").click();
    await expect(page.locator("#balance")).not.toHaveText(before!);
    await shot(page, `${lang}-1440x900-singleplayer`);
    expect(errors).toEqual([]);
    await page.context().close();
  }
});

// ---------- Layout and translation sweep ----------

// Each screen's audit is written to screenshots/report/<id>.json and checked right away
// (soft assertions: the sweep continues and every screenshot is still taken).
async function record(page: Page, lang: "en" | "fr", vp: ViewportName, name: string) {
  const id = `${lang}-${vp}-${name}`;
  await shot(page, id);
  const problems = await audit(page, lang);
  fs.mkdirSync(path.join(SHOTS, "report"), { recursive: true });
  fs.writeFileSync(path.join(SHOTS, "report", `${id}.json`), JSON.stringify(problems, null, 2));
  expect.soft(problems.filter((p) => HARD.has(p.kind)), id).toEqual([]);
}

for (const lang of ["en", "fr"] as const) {
  for (const vp of Object.keys(VIEWPORTS) as ViewportName[]) {
    test(`sweep ${lang} ${vp}: host and phone through a round`, async ({ browser }) => {
      const room = await createRoom(LAN);
      const code = room.roomCode;

      const intro = await newPage(browser, vp, lang);
      await intro.page.goto(`${LAN}/host`);
      await expect(intro.page.locator("#hostBtn")).toBeVisible();
      await record(intro.page, lang, vp, "host-1-intro");
      await intro.page.context().close();

      const host = await newPage(browser, vp, lang, { [`ascent-host:${code}`]: room.hostToken });
      await host.page.goto(`${LAN}/host?room=${code}`);
      await expect(host.page.locator("#conn")).toHaveAttribute("data-status", "open");
      await record(host.page, lang, vp, "host-2-empty-lobby");
      await host.page.locator("#qr").screenshot({ path: path.join(SHOTS, `qr-${lang}-${vp}.png`) });
      const qrSize = (await host.page.locator("#qr svg").boundingBox())!;
      expect(qrSize.width, "QR code drawn size").toBeGreaterThanOrEqual(200);

      const phone = await newPage(browser, vp, lang);
      await phone.page.goto(`${LAN}/join`);
      await expect(phone.page.locator("#codeForm")).toBeVisible();
      await record(phone.page, lang, vp, "phone-1-code-form");
      await phone.page.goto(`${LAN}/join/${code}`);
      await expect(phone.page.locator("#nameForm")).toBeVisible();
      await record(phone.page, lang, vp, "phone-2-name-form");
      await phone.page.locator("#nameInput").fill(lang === "fr" ? "Éloïse" : "Ana");
      await phone.page.locator("#joinBtn").click();
      await expect(phone.page.locator("#play")).toBeVisible();
      await joinRoom(LAN, code, "Bartholomew-Long"); // a long name, to check truncation
      await expect(phone.page.locator(".lb-row")).toHaveCount(2);
      await record(phone.page, lang, vp, "phone-3-waiting-for-host");

      await host.page.locator("#startBtn").click();
      await expect(phone.page.locator("#stage")).toHaveAttribute("data-state", "betting");
      await record(phone.page, lang, vp, "phone-4-betting");
      await phone.page.locator("#actionBtn").click(); // bet before the window closes; then capture the host
      await record(host.page, lang, vp, "host-3-betting");
      await expect(phone.page.locator("#meBalance")).toHaveText(/990[.,]00/);
      await record(phone.page, lang, vp, "phone-5-bet-placed");
      await expect(phone.page.locator("#actionBtn")).toHaveAttribute("data-mode", "cashout", { timeout: 15_000 });
      await record(phone.page, lang, vp, "phone-6-flying-cash-out");
      await expect(phone.page.locator("#result")).toHaveAttribute("data-tone", "lost", { timeout: 15_000 });
      await record(phone.page, lang, vp, "phone-7-lost");
      await expect.poll(() => ranks(host.page), { timeout: 15_000 }).toEqual(["1", "2"]);
      await record(host.page, lang, vp, "host-4-after-round");

      expect(host.errors.concat(phone.errors)).toEqual([]);
      await host.page.context().close();
      await phone.page.context().close();
    });
  }

  test(`error and empty states ${lang} (360x640)`, async ({ browser }) => {
    const vp: ViewportName = "360x640";
    // Bad room code
    const bad = await newPage(browser, vp, lang);
    await bad.page.goto(`${LAN}/join/ZZZZ`);
    await expect(bad.page.locator("#noticeText")).toHaveText((lang === "fr" ? FR : EN)["room.error.ROOM_NOT_FOUND"]);
    await record(bad.page, lang, vp, "state-bad-code");

    // Locked room
    const locked = await createRoom(LAN);
    const lockHost = await RoomClient.open(LAN, locked.roomCode, "host", locked.hostToken);
    expect((await lockHost.act("lock", { locked: true })).status).toBe(200);
    await bad.page.goto(`${LAN}/join/${locked.roomCode}`);
    await bad.page.locator("#nameInput").fill("Zoé");
    await bad.page.locator("#joinBtn").click();
    await expect(bad.page.locator("#joinError")).toHaveText((lang === "fr" ? FR : EN)["room.error.ROOM_LOCKED"]);
    await record(bad.page, lang, vp, "state-locked");

    // Full room (this server allows 4 players)
    const full = await createRoom(LAN);
    for (const n of ["P1", "P2", "P3", "P4"]) expect((await joinRoom(LAN, full.roomCode, n)).status).toBe(201);
    await bad.page.goto(`${LAN}/join/${full.roomCode}`);
    await bad.page.locator("#nameInput").fill("P5");
    await bad.page.locator("#joinBtn").click();
    await expect(bad.page.locator("#joinError")).toHaveText((lang === "fr" ? FR : EN)["room.error.ROOM_FULL"]);
    await record(bad.page, lang, vp, "state-full");

    // Kicked
    const kickRoom = await createRoom(LAN);
    const kickHost = await RoomClient.open(LAN, kickRoom.roomCode, "host", kickRoom.hostToken);
    const victim = (await joinRoom(LAN, kickRoom.roomCode, "Kim")).body;
    const kp = await newPage(browser, vp, lang, { [`ascent-session:${kickRoom.roomCode}`]: victim.sessionToken });
    await kp.page.goto(`${LAN}/join/${kickRoom.roomCode}`);
    await expect(kp.page.locator("#play")).toBeVisible();
    expect((await kickHost.act("kick", { playerId: victim.playerId })).status).toBe(200);
    await expect(kp.page.locator("#noticeText")).toHaveText((lang === "fr" ? FR : EN)["room.join.kicked"]);
    await record(kp.page, lang, vp, "state-kicked");

    // Lost connection, then back
    const live = (await joinRoom(LAN, kickRoom.roomCode, "Lou")).body;
    const lp = await newPage(browser, vp, lang, { [`ascent-session:${kickRoom.roomCode}`]: live.sessionToken });
    await lp.page.goto(`${LAN}/join/${kickRoom.roomCode}`);
    await expect(lp.page.locator("#conn")).toHaveAttribute("data-status", "open");
    await lp.page.context().setOffline(true);
    await expect(lp.page.locator("#conn")).toHaveAttribute("data-status", "offline", { timeout: 5_000 });
    await record(lp.page, lang, vp, "state-offline");
    await lp.page.context().setOffline(false);
    await expect(lp.page.locator("#conn")).toHaveAttribute("data-status", "open", { timeout: 20_000 });

    // Empty lobby on a phone-sized host screen is covered by the sweep (host-2-empty-lobby).
    for (const c of [lockHost, kickHost]) c.close();
    for (const x of [bad, kp, lp]) await x.page.context().close();
  });
}
