// Настройка Playwright и готовые профили устройств
import { defineConfig, devices } from "@playwright/test";
// os — системная временная папка для базы
import os from "node:os";
// path — пути к папкам backend и тестов
import path from "node:path";

// E2E поднимает собственные копии бэкенда (порт 8001, временная БД) и фронтенда (порт 3001),
// поэтому не трогает ваши рабочие проекты на 8000/3000.
// Порт отдельного бэкенда для e2e
const BACKEND_PORT = 8001;
// Порт отдельного фронтенда для e2e
const FRONT_PORT = 3001;
// Каким Python запускать бэкенд: из переменной, иначе по системе
const python = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
// Новая временная база на каждый запуск — тесты не видят старых данных
const e2eDb = path.join(os.tmpdir(), `stringart-e2e-${Date.now()}.db`);

// Общие настройки
export default defineConfig({
  // Где лежат e2e-тесты
  testDir: "./tests/e2e",
  // Один тест — не дольше минуты
  timeout: 60_000,
  // Одна проверка ждёт до 10 с
  expect: { timeout: 10_000 },
  // Тесты не идут параллельно: у них общий сервер и база
  fullyParallel: false,
  // Один поток
  workers: 1,
  // На CI — одна повторная попытка при сбое, локально — нет
  retries: process.env.CI ? 1 : 0,
  // Отчёты: на CI — список, аннотации GitHub, HTML и JUnit; локально — список
  reporter: process.env.CI ? [["list"], ["github"], ["html", { open: "never" }], ["junit", { outputFile: "test-results/junit.xml" }]] : "list",
  // Настройки браузера:
  use: {
    // адрес фронтенда
    baseURL: `http://127.0.0.1:${FRONT_PORT}`,
    // русская локаль
    locale: "ru-RU",
    // трасса только для упавших тестов
    trace: "retain-on-failure",
    // Без UTF-8 локали Chromium на Linux не может сохранить файл с кириллицей в имени
    // и называет загрузку «download». На macOS/Windows это не нужно, но и не мешает.
    // переменные окружения браузера
    launchOptions: { env: { ...process.env, LANG: process.env.LANG || "C.UTF-8" } },
    // снимок экрана только при падении
    screenshot: "only-on-failure",
  },
  // Два профиля:
  projects: [
    // компьютер — все тесты
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    // телефон Pixel 7 — только тесты интерфейса
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] }, testMatch: /(ui|extras)\.spec\.ts/ },
  ],
  // Серверы, которые Playwright сам поднимет перед тестами:
  webServer: [
    // бэкенд —
    {
      // команда запуска
      command: `${python} -m uvicorn app.main:app --port ${BACKEND_PORT}`,
      // из папки backend
      cwd: path.join(__dirname, "..", "backend"),
      // со своей базой
      env: { STRINGART_DB: e2eDb },
      // готов, когда отвечает /api/health
      url: `http://127.0.0.1:${BACKEND_PORT}/api/health`,
      // не использовать уже запущенный
      reuseExistingServer: false,
      // ждать до минуты
      timeout: 60_000,
    },
    // фронтенд —
    {
      // dev-сервер Next.js на своём порту
      command: `npx next dev --webpack -p ${FRONT_PORT}`,
      // ходит в «свой» бэкенд, без телеметрии
      env: { BACKEND_URL: `http://127.0.0.1:${BACKEND_PORT}`, NEXT_TELEMETRY_DISABLED: "1" },
      // готов, когда отвечает главная
      url: `http://127.0.0.1:${FRONT_PORT}`,
      // не использовать уже запущенный
      reuseExistingServer: false,
      // ждать до двух минут
      timeout: 120_000,
    },
  ],
});
