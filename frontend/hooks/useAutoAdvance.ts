// Директива Next.js: код выполняется в браузере (хуки состояния работают только там)
"use client";

// useEffect — запуск таймера; useRef — хранение последней версии колбэка
import { useEffect, useRef } from "react";

/**
 * Автоперелистывание: пока playing, через intervalMs вызывает onTick.
 * Таймер перезапускается при каждой смене шага — ручное «вперёд/назад»
 * даёт человеку полный интервал на новый шаг.
 */
// Хук автоперелистывания
export function useAutoAdvance(playing: boolean, intervalMs: number, step: number, onTick: () => void) {
  // Храним колбэк в ref — таймер вызовет самую свежую версию, не перезапускаясь из-за неё
  const tick = useRef(onTick);
  // Обновляем при каждом рендере
  tick.current = onTick;

  // Эффект перезапускается при смене playing, интервала или шага
  useEffect(() => {
    // На паузе таймер не нужен
    if (!playing) return;
    // Одноразовый таймер: через интервал — следующий шаг
    const t = setTimeout(() => tick.current(), intervalMs);
    // При смене шага/паузе старый таймер отменяется
    return () => clearTimeout(t);
    // Зависимости эффекта: при их смене таймер перезапускается
  }, [playing, intervalMs, step]);
}
