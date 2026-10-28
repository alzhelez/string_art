// Компонент работает в браузере
"use client";

// Хуки React
import { useEffect, useRef, useState } from "react";
// Функция рисования доски и тип её параметров
import { drawBoard, type DrawOptions } from "@/lib/draw";

// Свойства: всё для рисования, кроме размера (его считаем сами), + подпись и предел пикселей
type Props = Omit<DrawOptions, "size"> & { label: string; maxPixels?: number };

/** Круглая картина на canvas; подстраивается под ширину контейнера и плотность экрана. */
// Компонент «картина на холсте»
export function Board({ label, maxPixels = 1600, ...draw }: Props) {
  // Ссылка на обёртку — по её ширине выбираем размер холста
  const wrapRef = useRef<HTMLDivElement>(null);
  // Ссылка на холст
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Размер холста в физических пикселях (0 — ещё не измерили)
  const [size, setSize] = useState(0);

  // Следим за шириной обёртки
  useEffect(() => {
    // Обёртка
    const el = wrapRef.current;
    // Ещё нет на странице
    if (!el) return;
    // Пересчитать размер
    const update = () => {
      // Плотность пикселей экрана (на Retina — 2): рисуем чётко
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      // Ширина × плотность, но не больше maxPixels
      setSize(Math.min(maxPixels, Math.round(el.clientWidth * dpr)));
    };
    // Сразу при появлении
    update();
    // Старый браузер без ResizeObserver — дальше не следим
    if (typeof ResizeObserver === "undefined") return;
    // Наблюдатель за размером обёртки
    const ro = new ResizeObserver(update);
    // Начать наблюдение
    ro.observe(el);
    // Прекратить при уходе со страницы
    return () => ro.disconnect();
  // При смене предела
  }, [maxPixels]);

  // Параметры рисования по отдельности (для списка зависимостей эффекта)
  const { sequence, lines, diameterCm, activeStep, doneOpacity, layers, activeLayer, boardColor } = draw;
  // Перерисовать при смене темы (подписи гвоздей берут цвет из темы)
  // Счётчик смен темы
  const [themeTick, setThemeTick] = useState(0);
  // Следим за атрибутом data-theme у <html>
  useEffect(() => {
    // Любая смена → счётчик + 1
    const mo = new MutationObserver(() => setThemeTick((t) => t + 1));
    // Наблюдаем только за data-theme
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    // Отключить при уходе
    return () => mo.disconnect();
  // Один раз
  }, []);
  // Рисуем при любом изменении
  useEffect(() => {
    // Холст
    const canvas = canvasRef.current;
    // Нет холста или размер ещё неизвестен
    if (!canvas || size === 0) return;
    // Контекст рисования
    const ctx = canvas.getContext("2d");
    // Нет контекста (тесты)
    if (!ctx) return;
    // Рисуем в следующем кадре экрана — несколько изменений подряд дадут одну отрисовку
    const raf = requestAnimationFrame(() => {
      // Вычисленные стили страницы (цвета темы)
      const css = getComputedStyle(document.documentElement);
      // Значение CSS-переменной (или undefined, если пусто)
      const v = (name: string) => css.getPropertyValue(name).trim() || undefined;
      // Цвета подписей, осей и акцента из темы
      const colors = { graphite: v("--text"), steel: v("--text-2"), chalk: v("--accent") };
      // Рисуем
      drawBoard(ctx, { sequence, lines, diameterCm, activeStep, doneOpacity, layers, activeLayer, boardColor, size, colors: colors as never });
    });
    // Отменить, если до кадра пришло новое изменение
    return () => cancelAnimationFrame(raf);
  // Зависимости
  }, [sequence, lines, diameterCm, activeStep, doneOpacity, layers, activeLayer, boardColor, size, themeTick]);

  // Разметка
  return (
    // Обёртка, по которой измеряется ширина
    <div className="board" ref={wrapRef}>
      {/* Сам холст */}
      <canvas
        // Ссылка для эффекта
        ref={canvasRef}
        // Ширина в пикселях (минимум 1)
        width={size || 1}
        // Высота
        height={size || 1}
        // Для экранного диктора — это картинка
        role="img"
        // Её описание
        aria-label={label}
        // Метка для автотестов
        data-testid="board"
        // Сколько линий нарисовано — проверяют автотесты
        data-lines={activeStep !== undefined ? activeStep - 1 : lines}
      />
    </div>
  );
}
