// Хук работает в браузере
"use client";

// useCallback — стабильные функции; useEffect — подписка на уход со страницы; useRef — хранение без перерисовки
import { useCallback, useEffect, useRef } from "react";
// Запросы к API и тип изменений проекта
import { api, type ProjectPatch } from "@/lib/api";

/**
 * Копит изменения проекта и отправляет одним PATCH через delayMs.
 * flush() — отправить немедленно (перед скачиванием PDF, уходом со страницы).
 */
// Хук отложенного сохранения
export function useDebouncedPatch(projectId: string | undefined, delayMs = 400, onError?: (e: unknown) => void) {
  // Накопленные, ещё не отправленные изменения
  const pending = useRef<ProjectPatch>({});
  // Таймер отложенной отправки
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Свежий обработчик ошибок
  const errorRef = useRef(onError);
  // Обновляем при каждом рендере
  errorRef.current = onError;

  // Отправить накопленное прямо сейчас
  const flush = useCallback(
    // keepalive — запрос переживёт закрытие вкладки
    async (keepalive = false) => {
      // Отменяем отложенную отправку
      if (timer.current) clearTimeout(timer.current);
      // Таймера больше нет
      timer.current = null;
      // Забираем накопленное
      const patch = pending.current;
      // И очищаем
      pending.current = {};
      // Нечего отправлять или нет проекта
      if (!projectId || Object.keys(patch).length === 0) return;
      // Запрос может не пройти
      try {
        // Отправляем PATCH
        await api.update(projectId, patch, keepalive);
        // Ошибка
      } catch (e) {
        // Сообщаем родителю (он покажет предупреждение)
        errorRef.current?.(e);
      }
    },
    // Функция пересоздаётся только при смене проекта
    [projectId],
  );

  // Запланировать изменения
  const schedule = useCallback(
    // Новые изменения
    (patch: ProjectPatch) => {
      // Сливаем с накопленными (новые значения перекрывают старые)
      pending.current = { ...pending.current, ...patch };
      // Сбрасываем прежний таймер — отсчёт начинается заново
      if (timer.current) clearTimeout(timer.current);
      // Отправим через delayMs после последнего изменения
      timer.current = setTimeout(() => void flush(), delayMs);
    },
    // Зависимости
    [flush, delayMs],
  );

  // Закрыли вкладку или ушли со страницы — сохраняем то, что не успели.
  useEffect(() => {
    // Обработчик скрытия страницы
    const onHide = () => void flush(true);
    // pagehide срабатывает при закрытии и переходе со страницы
    window.addEventListener("pagehide", onHide);
    // При размонтировании компонента
    return () => {
      // Отписываемся
      window.removeEventListener("pagehide", onHide);
      // И отправляем остатки
      void flush(true);
    };
    // Перезапускаем при смене flush
  }, [flush]);

  // Наружу — две функции
  return { schedule, flush };
}
