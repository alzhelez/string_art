"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "./ui/Icon";

type Theme = "light" | "dark";
const KEY = "stringart.theme";

/** Мини-кольцо гвоздей — знак приложения. */
function Mark() {
  const dots = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    return <circle key={i} cx={(16 + 12 * Math.sin(a)).toFixed(2)} cy={(16 - 12 * Math.cos(a)).toFixed(2)} r={1.1} />;
  });
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <g className="brand-mark-dots">{dots}</g>
      <path className="brand-mark-line" d="M4.5 13 L26 22.5 M9 27 L22.5 5" />
    </svg>
  );
}

export function AppHeader() {
  const path = usePathname();
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* приватный режим — тема просто не запомнится */
    }
    setTheme(next);
  };

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link href="/" className="brand" aria-label="Нитеграф — на главную">
          <Mark />
          <span>Нитеграф</span>
        </Link>
        <nav className="app-nav" aria-label="Разделы">
          <Link href="/" aria-current={path === "/" ? "page" : undefined}>
            Портреты
          </Link>
        </nav>
        <button
          type="button"
          className="icon-btn"
          onClick={toggle}
          aria-label={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
          title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
      </div>
    </header>
  );
}

/** Скрипт в <head>: ставит тему до отрисовки, чтобы не было вспышки светлой темы. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(!t)t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}`;
