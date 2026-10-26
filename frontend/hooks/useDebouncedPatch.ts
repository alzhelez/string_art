"use client";

import { useCallback, useEffect, useRef } from "react";
import { api, type ProjectPatch } from "@/lib/api";

/**
 * Копит изменения проекта и отправляет одним PATCH через delayMs.
 * flush() — отправить немедленно (перед скачиванием PDF, уходом со страницы).
 */
export function useDebouncedPatch(projectId: string | undefined, delayMs = 400, onError?: (e: unknown) => void) {
  const pending = useRef<ProjectPatch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;

  const flush = useCallback(
    async (keepalive = false) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const patch = pending.current;
      pending.current = {};
      if (!projectId || Object.keys(patch).length === 0) return;
      try {
        await api.update(projectId, patch, keepalive);
      } catch (e) {
        errorRef.current?.(e);
      }
    },
    [projectId],
  );

  const schedule = useCallback(
    (patch: ProjectPatch) => {
      pending.current = { ...pending.current, ...patch };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delayMs);
    },
    [flush, delayMs],
  );

  // Закрыли вкладку или ушли со страницы — сохраняем то, что не успели.
  useEffect(() => {
    const onHide = () => void flush(true);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void flush(true);
    };
  }, [flush]);

  return { schedule, flush };
}
