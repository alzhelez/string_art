// Компонент работает в браузере
"use client";

// Ссылка Next.js — переход без перезагрузки страницы
import Link from "next/link";
// Текущий адрес страницы
import { usePathname } from "next/navigation";
// Хуки React
import { useEffect, useState } from "react";
// Значки
import { Icon } from "./ui/Icon";

// Тема оформления
type Theme = "light" | "dark";
// Ключ хранения темы
const KEY = "stringart.theme";

/** Мини-кольцо гвоздей — знак приложения. */
// Значок приложения: кольцо из 24 точек и две нити
function Mark() {
  // 24 точки по кругу
  const dots = Array.from({ length: 24 }, (_, i) => {
    // Угол точки
    const a = (i / 24) * Math.PI * 2;
    // Точка (координаты округлены — одинаково на сервере и в браузере)
    return <circle key={i} cx={(16 + 12 * Math.sin(a)).toFixed(2)} cy={(16 - 12 * Math.cos(a)).toFixed(2)} r={1.1} />;
  });
  // Разметка
  return (
    // Векторный значок, скрытый от экранного диктора
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      {/* Точки-гвозди */}
      <g className="brand-mark-dots">{dots}</g>
      {/* Две нити */}
      <path className="brand-mark-line" d="M4.5 13 L26 22.5 M9 27 L22.5 5" />
    </svg>
  );
}

// Шапка сайта
export function AppHeader() {
  // Текущий адрес (для выделения пункта меню)
  const path = usePathname();
  // Тема (null — ещё не знаем, до первого эффекта)
  const [theme, setTheme] = useState<Theme | null>(null);

  // Узнаём тему, которую поставил скрипт в <head>
  useEffect(() => {
    // Из атрибута data-theme
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  // Один раз
  }, []);

  // Переключить тему
  const toggle = () => {
    // Противоположная
    const next: Theme = theme === "dark" ? "light" : "dark";
    // Применяем к странице
    document.documentElement.dataset.theme = next;
    // Запоминаем
    try {
      // В localStorage
      localStorage.setItem(KEY, next);
    // Не получилось
    } catch {
      /* приватный режим — тема просто не запомнится */
    }
    // В состояние — сменится значок кнопки
    setTheme(next);
  };

  // Разметка
  return (
    // Шапка
    <header className="app-header">
      {/* Внутренний контейнер (ограничивает ширину) */}
      <div className="app-header-inner">
        {/* Логотип — ссылка на главную */}
        <Link href="/" className="brand" aria-label="Нитеграф — на главную">
          {/* Значок */}
          <Mark />
          {/* Название */}
          <span>Нитеграф</span>
        </Link>
        {/* Меню разделов */}
        <nav className="app-nav" aria-label="Разделы">
          {/* Пункт «Портреты»; aria-current — выделение текущей страницы */}
          <Link href="/" aria-current={path === "/" ? "page" : undefined}>
            {/* Текст пункта */}
            Портреты
          </Link>
        </nav>
        {/* Кнопка переключения темы */}
        <button
          // Обычная кнопка
          type="button"
          // Круглая кнопка-значок
          className="icon-btn"
          // По нажатию — переключить
          onClick={toggle}
          // Описание для экранного диктора
          aria-label={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
          // Подсказка при наведении
          title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
        >
          {/* Солнце в тёмной теме, луна — в светлой */}
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
      </div>
    </header>
  );
}

// Текст скрипта (выполняется до React): тема из localStorage или из настроек системы
/** Скрипт в <head>: ставит тему до отрисовки, чтобы не было вспышки светлой темы. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(!t)t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}`;
