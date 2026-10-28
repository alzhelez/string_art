// Тип настроек Next.js
import type { NextConfig } from "next";

// Все запросы /api/* фронтенд проксирует на Python-бэкенд — CORS не нужен.
// Сборка идёт через webpack (флаг --webpack в package.json): Turbopack требует нативный
// модуль SWC, который на части Windows-машин не загружается, а webpack работает и с WASM-версией.
// Адрес бэкенда (Playwright подставляет свой порт)
const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

// Десктопная версия (npm run build:desktop): статические файлы в папке out/,
// их раздаёт сам Python-бэкенд — Node.js на компьютере пользователя не нужен.
// Признак сборки для программы
const desktop = process.env.STRINGART_DESKTOP === "1";

// Две разные конфигурации: для программы и для обычного запуска
const nextConfig: NextConfig = desktop
  // Программа для Windows
  ? {
      // Статический экспорт: только HTML/JS/CSS-файлы
      output: "export",
      // Куда сложить
      distDir: "out", // готовый сайт — здесь; не мешает запущенному npm run dev (.next)
      // Оптимизация картинок требует сервер Node.js — отключаем
      images: { unoptimized: true },
    }
  // Обычный режим (npm run dev / build + start)
  : {
      // dev-сервер Next 16 по умолчанию не отдаёт скрипты «чужим» origin — разрешаем 127.0.0.1 (e2e, телефон в той же сети)
      allowedDevOrigins: ["127.0.0.1", "localhost"],
      // Прокси к бэкенду по умолчанию обрывает запрос через 30 с. Долгие операции бэкенд и так
      // выполняет в фоне, но расчёт портрета на медленном компьютере может занять дольше — даём 10 минут.
      experimental: { proxyTimeout: 600_000 },
      // Переадресация запросов
      async rewrites() {
        // /api/что-угодно → бэкенд
        return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
      },
      // Старые адреса (/projects/<id>) — из закладок и истории браузера
      async redirects() {
        // Список перенаправлений (permanent: false — временные, браузер не запомнит навсегда)
        return [
          // Плетение
          { source: "/projects/:id/weave", destination: "/project/weave?id=:id", permanent: false },
          // Правка фото
          { source: "/projects/:id/photo", destination: "/project/photo?id=:id", permanent: false },
          // Студия
          { source: "/projects/:id", destination: "/project?id=:id", permanent: false },
        ];
      },
    };

// Отдаём настройки Next.js
export default nextConfig;
