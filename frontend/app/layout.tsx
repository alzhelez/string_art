import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "@fontsource/golos-text/400.css";
import "@fontsource/golos-text/500.css";
import "@fontsource/golos-text/600.css";
import "@fontsource/unbounded/500.css";
import "@fontsource/unbounded/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Нитеграф — портрет из нитей",
  description: "Превращает фото в круглую картину из лески: 240 гвоздей, пошаговая инструкция, расчёт катушки.",
};

export const viewport: Viewport = { themeColor: "#e6eaee", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            Нитеграф
          </Link>
          <span className="brand-note">портреты из лески на 240 гвоздях</span>
        </header>
        <main className="site-main">{children}</main>
      </body>
    </html>
  );
}
