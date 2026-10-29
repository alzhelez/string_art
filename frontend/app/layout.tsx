// Типы Next.js для метаданных страницы и настроек экрана
import type { Metadata, Viewport } from "next";
// Плашка «вышла новая версия» (только в программе для Windows)
import { UpdateNotice } from "@/components/UpdateNotice";
// Шапка сайта и скрипт ранней установки темы
import { AppHeader, THEME_SCRIPT } from "@/components/AppHeader";
// Запуск версии для телефона (в остальных версиях просто показывает страницу)
import { LocalGate } from "@/components/LocalGate";
// Признак версии для телефона и адрес сайта
import { BASE_PATH, LOCAL_MODE } from "@/lib/local/client";
// Шрифт Golos Text, обычное начертание (шрифты лежат в пакете — работают без интернета)
import "@fontsource/golos-text/400.css";
// Golos Text, средний
import "@fontsource/golos-text/500.css";
// Golos Text, полужирный
import "@fontsource/golos-text/600.css";
// Шрифт заголовков Unbounded, средний
import "@fontsource/unbounded/500.css";
// Unbounded, жирный
import "@fontsource/unbounded/700.css";
// Все стили приложения
import "./globals.css";

// Заголовок вкладки и описание для поисковиков и превью ссылок
export const metadata: Metadata = {
  // Заголовок вкладки браузера
  title: "Нитеграф — портрет из нитей",
  // Описание
  description: "Превращает фото в круглую картину из лески: 240 гвоздей, пошаговая инструкция, расчёт катушки.",
  // Версия для телефона ставится как приложение: манифест и значок для iPhone
  ...(LOCAL_MODE && {
    // Манифест приложения
    manifest: `${BASE_PATH}/manifest.webmanifest`,
    // Значок на экране «Домой» у iPhone
    icons: { apple: `${BASE_PATH}/icons/icon-192.png` },
    // На iPhone — без адресной строки
    appleWebApp: { capable: true, title: "Нитеграф", statusBarStyle: "default" },
  }),
};

// Настройки экрана для телефонов
export const viewport: Viewport = {
  // Ширина страницы = ширина экрана устройства
  width: "device-width",
  // Без увеличения при открытии
  initialScale: 1,
  // Цвет строки браузера на телефоне под светлую и тёмную тему
  themeColor: [
    // Светлая тема
    { media: "(prefers-color-scheme: light)", color: "#eef0f3" },
    // Тёмная тема
    { media: "(prefers-color-scheme: dark)", color: "#0f1216" },
  ],
};

// Общий каркас всех страниц; children — содержимое конкретной страницы
export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Разметка документа
  return (
    // Язык русский; suppressHydrationWarning — тему ставит скрипт до React, атрибуты html могут отличаться
    <html lang="ru" suppressHydrationWarning>
      {/* Заголовок документа */}
      <head>
        {/* Скрипт ставит тёмную/светлую тему до отрисовки — без вспышки белого экрана */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      {/* Тело страницы */}
      <body>
        {/* Шапка */}
        <AppHeader />
        {/* Основное содержимое */}
        <main className="site-main">
          {/* В версии для телефона — после запуска «сервера» в браузере */}
          <LocalGate>
            {/* Уведомление об обновлении (если есть) */}
            <UpdateNotice />
            {/* Сама страница */}
            {children}
          </LocalGate>
        </main>
      </body>
    </html>
  );
}
