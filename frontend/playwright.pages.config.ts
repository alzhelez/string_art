// Сквозные тесты версии для телефона (GitHub Pages): собранный сайт из out/ в настоящем браузере.
// Перед запуском: npm run build:pages. Запуск: npx playwright test -c playwright.pages.config.ts
// Бэкенд не нужен — всё считается и хранится в браузере.

// Настройки и готовые устройства
import { defineConfig, devices } from "@playwright/test";

// Порт статического сервера
const PORT = 3003;

// Настройки
export default defineConfig({
  // Папка тестов
  testDir: "./tests/pages",
  // Тест — до 2 минут (расчёт цветного портрета в телефоне)
  timeout: 120_000,
  // Ожидание проверок — до 30 с
  expect: { timeout: 30_000 },
  // По одному: у каждого теста своё хранилище браузера, но порт один
  workers: 1,
  // В CI — один повтор
  retries: process.env.CI ? 1 : 0,
  // Отчёты
  reporter: process.env.CI ? [["list"], ["github"], ["html", { open: "never", outputFolder: "playwright-report-pages" }]] : "list",
  // Общие настройки страниц
  use: {
    // Сайт лежит в /string_art/, как на GitHub Pages
    baseURL: `http://127.0.0.1:${PORT}/string_art/`,
    // Русская локаль
    locale: "ru-RU",
    // След при ошибке
    trace: "retain-on-failure",
    // Снимок при ошибке
    screenshot: "only-on-failure",
  },
  // Устройства: телефон Android (Chrome); в CI ещё iPhone (Safari/WebKit)
  projects: [
    // Android
    { name: "android-chrome", use: { ...devices["Pixel 7"] } },
    // iPhone — только если браузер WebKit установлен (в CI)
    ...(process.env.PAGES_WEBKIT === "1" ? [{ name: "iphone-safari", use: { ...devices["iPhone 14"] } }] : []),
  ],
  // Статический сервер собранной версии
  webServer: {
    // Команда
    command: `node scripts/serve-pages.mjs out`,
    // Порт
    env: { PORT: String(PORT) },
    // Готовность
    url: `http://127.0.0.1:${PORT}/string_art/`,
    // Не переиспользовать чужой
    reuseExistingServer: false,
    // До 30 с
    timeout: 30_000,
  },
});
