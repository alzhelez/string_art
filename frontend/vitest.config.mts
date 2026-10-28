// Плагин React для Vite (JSX, быстрая перезагрузка)
import react from "@vitejs/plugin-react";
// Перевод адреса модуля в путь файла
import { fileURLToPath } from "node:url";
// Функция описания настроек Vitest
import { defineConfig } from "vitest/config";

// Настройки юнит-тестов
export default defineConfig({
  // Подключаем React
  plugins: [react()],
  // Псевдоним «@/» = папка frontend (как в tsconfig.json)
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  // Параметры тестов
  test: {
    // jsdom — имитация браузера (DOM) в Node.js
    environment: "jsdom",
    // describe/it/expect доступны без импорта
    globals: true,
    // Общая подготовка перед тестами
    setupFiles: ["./tests/unit/setup.ts"],
    // Какие файлы считать тестами
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    // Отчёт о покрытии (npm run test:coverage)
    coverage: {
      // Покрытие считает сам движок V8 — без переделки кода
      provider: "v8",
      // Что учитывать: логику, хуки и компоненты (страницы проверяет Playwright)
      include: ["lib/**", "hooks/**", "components/**"],
      // Текст в консоль и HTML-отчёт в папку coverage/
      reporter: ["text-summary", "html"],
    },
  },
});
