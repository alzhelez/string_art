// Сквозные тесты версии для телефона (GitHub Pages): собранный сайт без Python-бэкенда.
// Перед запуском: npm run build:pages. Запуск: npx playwright test -c playwright.pages.config.ts

// Настройки Playwright и готовые устройства
import { defineConfig, devices } from "@playwright/test";

// Порт статического сервера
const PORT = 3002;

// Настройки
export default defineConfig({
  // Тесты версии для телефона
  testDir: "./tests/pages",
  // Цветной портрет на слабой машине CI считается дольше — 2 минуты на тест
  timeout: 120_000,
  // Ожидание проверок
  expect: { timeout: 15_000 },
  // По одному: тесты делят хранилище браузера внутри своего контекста, но не мешают друг другу
  workers: 1,
  // В CI — одна повторная попытка
  retries: process.env.CI ? 1 : 0,
  // Отчёты: в CI — список, аннотации GitHub, HTML и JUnit
  reporter: process.env.CI ? [["list"], ["github"], ["html", { open: "never", outputFolder: "playwright-report-pages" }], ["junit", { outputFile: "test-results/junit-pages.xml" }]] : "list",
  // Общие настройки
  use: {
    // Адрес сайта — как на GitHub Pages
    baseURL: `http://127.0.0.1:${PORT}/string_art/`,
    // Русский язык
    locale: "ru-RU",
    // След выполнения — при падении
    trace: "retain-on-failure",
    // Снимок — при падении
    screenshot: "only-on-failure",
    // Service worker должен работать
    serviceWorkers: "allow",
    // Браузер в UTF-8 — иначе русские имена скачанных файлов превращаются в «download»
    launchOptions: { env: { ...process.env, LANG: process.env.LANG || "C.UTF-8" } },
  },
  // Телефон Android и iPhone-размер экрана в Chromium
  projects: [
    // Телефон Android
    { name: "pixel", use: { ...devices["Pixel 7"] } },
  ],
  // Статический сервер собранной папки out/
  webServer: {
    // Команда
    command: "node scripts/serve-pages.mjs out",
    // Порт
    env: { PORT: String(PORT) },
    // Готовность
    url: `http://127.0.0.1:${PORT}/string_art/`,
    // Не использовать уже запущенный
    reuseExistingServer: false,
    // Время на запуск
    timeout: 30_000,
  },
});
