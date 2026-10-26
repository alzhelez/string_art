import type { NextConfig } from "next";

// Все запросы /api/* фронтенд проксирует на Python-бэкенд — CORS не нужен.
// Сборка идёт через webpack (флаг --webpack в package.json): Turbopack требует нативный
// модуль SWC, который на части Windows-машин не загружается, а webpack работает и с WASM-версией.
const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // dev-сервер Next 16 по умолчанию не отдаёт скрипты «чужим» origin — разрешаем 127.0.0.1 (e2e, телефон в той же сети)
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Прокси к бэкенду по умолчанию обрывает запрос через 30 с. Долгие операции бэкенд и так
  // выполняет в фоне, но расчёт портрета на медленном компьютере может занять дольше — даём 10 минут.
  experimental: { proxyTimeout: 600_000 },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};

export default nextConfig;
