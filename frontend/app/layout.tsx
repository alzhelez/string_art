import type { Metadata, Viewport } from "next";
import { AppHeader, THEME_SCRIPT } from "@/components/AppHeader";
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef0f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1216" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <AppHeader />
        <main className="site-main">{children}</main>
      </body>
    </html>
  );
}
