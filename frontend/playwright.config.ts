import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

// E2E поднимает собственные копии бэкенда (порт 8001, временная БД) и фронтенда (порт 3001),
// поэтому не трогает ваши рабочие проекты на 8000/3000.
const BACKEND_PORT = 8001;
const FRONT_PORT = 3001;
const python = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const e2eDb = path.join(os.tmpdir(), `stringart-e2e-${Date.now()}.db`);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"], ["html", { open: "never" }], ["junit", { outputFile: "test-results/junit.xml" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${FRONT_PORT}`,
    locale: "ru-RU",
    trace: "retain-on-failure",
    // Без UTF-8 локали Chromium на Linux не может сохранить файл с кириллицей в имени
    // и называет загрузку «download». На macOS/Windows это не нужно, но и не мешает.
    launchOptions: { env: { ...process.env, LANG: process.env.LANG || "C.UTF-8" } },
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] }, testMatch: /(ui|extras)\.spec\.ts/ },
  ],
  webServer: [
    {
      command: `${python} -m uvicorn app.main:app --port ${BACKEND_PORT}`,
      cwd: path.join(__dirname, "..", "backend"),
      env: { STRINGART_DB: e2eDb },
      url: `http://127.0.0.1:${BACKEND_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx next dev --webpack -p ${FRONT_PORT}`,
      env: { BACKEND_URL: `http://127.0.0.1:${BACKEND_PORT}`, NEXT_TELEMETRY_DISABLED: "1" },
      url: `http://127.0.0.1:${FRONT_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
