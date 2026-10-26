import type { NextConfig } from "next";

// Все запросы /api/* фронтенд проксирует на Python-бэкенд — CORS не нужен.
const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // dev-сервер Next 16 по умолчанию не отдаёт скрипты «чужим» origin — разрешаем 127.0.0.1 (e2e, телефон в той же сети)
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};

export default nextConfig;
