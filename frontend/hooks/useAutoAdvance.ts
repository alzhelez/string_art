"use client";

import { useEffect, useRef } from "react";

/**
 * Автоперелистывание: пока playing, через intervalMs вызывает onTick.
 * Таймер перезапускается при каждой смене шага — ручное «вперёд/назад»
 * даёт человеку полный интервал на новый шаг.
 */
export function useAutoAdvance(playing: boolean, intervalMs: number, step: number, onTick: () => void) {
  const tick = useRef(onTick);
  tick.current = onTick;

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => tick.current(), intervalMs);
    return () => clearTimeout(t);
  }, [playing, intervalMs, step]);
}
