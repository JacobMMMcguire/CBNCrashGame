// Playwright end-to-end tests for multiplayer rooms. Run from e2e/: npm test
//
// - Uses the installed Microsoft Edge (channel "msedge"); no Playwright browser download.
// - Starts its own server on port 8799 with in-memory storage and a fast game
//   config (e2e/game.e2e.json). It never reuses a running server, so it cannot
//   touch a dev server or the real SQLite file.
// - Playwright stops the server when the run ends; serve.py also exits if this
//   runner process disappears.
import { defineConfig } from "@playwright/test";
import path from "node:path";

const PORT = 8799;
const repo = path.resolve(__dirname, "..");
const python = process.platform === "win32"
  ? path.join(repo, ".venv", "Scripts", "python.exe")
  : path.join(repo, ".venv", "bin", "python");

const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1, // one shared server whose rooms run on real time
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: BASE_URL,
    channel: "msedge",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `"${python}" "${path.join(__dirname, "serve.py")}"`,
    url: `${BASE_URL}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 3_000 },
    env: {
      E2E_PORT: String(PORT),
      E2E_PARENT_PID: String(process.pid),
      STORAGE_BACKEND: "memory",
      SQLITE_PATH: path.join(__dirname, "test-results", "never-used.sqlite3"),
      ASCENT_CONFIG: path.join(__dirname, "game.e2e.json"),
      ASCENT_HOST: "127.0.0.1",
      PUBLIC_BASE_URL: BASE_URL,
      SEAT_HOLD_SECONDS: "120",
      MAX_PLAYERS_PER_ROOM: "50",
      PYTHONUNBUFFERED: "1",
    },
  },
});
