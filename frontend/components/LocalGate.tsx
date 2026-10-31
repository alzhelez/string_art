// Компонент работает в браузере
"use client";

// Текущий адрес страницы
import { usePathname } from "next/navigation";
// Состояние и эффекты React
import { startTransition, useEffect, useState } from "react";
// Запуск версии для телефона и подсказки о ходе расчёта
import { LOCAL_MODE, onProgress, startLocal } from "@/lib/local/client";

/**
 * Версия для телефона: запускает «сервер» в браузере (service worker + Web Worker),
 * показывает, где хранятся портреты, и подсказки о долгих расчётах. Страницы видны сразу:
 * их запросы к API сами дожидаются запуска (см. request в lib/api.ts). Подменять страницу
 * заставкой нельзя — тогда HTML сборки не совпадает с первой отрисовкой (ошибка React #418).
 * В обычной версии и в программе для Windows просто показывает содержимое.
 */
// Обёртка версии для телефона
export function LocalGate({ children }: { children: React.ReactNode }) {
  // Запущен ли «сервер» (до запуска пояснение не показываем)
  const [ready, setReady] = useState(false);
  // Текст ошибки запуска
  const [error, setError] = useState("");
  // Подсказка о ходе расчёта («Считаем нить 2 из 3…»)
  const [note, setNote] = useState<string | null>(null);
  // Адрес страницы — пояснение показываем только на главной
  const path = usePathname();

  // Запуск один раз
  useEffect(() => {
    // Обычная версия — ничего не делаем
    if (!LOCAL_MODE) return;
    // Подписка на подсказки (как переход: сначала React дорисовывает страницу из HTML, потом меняет плашки)
    const off = onProgress((n) => startTransition(() => setNote(n)));
    // Запускаем
    startLocal()
      // Готово
      .then(() => startTransition(() => setReady(true)))
      // Не получилось
      .catch((e: Error) => startTransition(() => setError(e.message)));
    // При уходе — отписка
    return off;
    // [] — один раз
  }, []);

  // Страница и плашки версии для телефона
  return (
    // Без лишней обёртки
    <>
      {/* Не получилось запустить — объясняем над страницей */}
      {error && (
        // Ошибка
        <div className="local-gate" role="alert">
          {/* Заголовок */}
          <h1>Не получилось запустить «Нитеграф»</h1>
          {/* Причина */}
          <p>{error}</p>
        </div>
      )}
      {/* На главной версии для телефона — коротко, где хранятся портреты */}
      {ready && path === "/" && (
        // Пояснение
        <p className="local-banner" data-testid="local-banner">
          {/* Текст */}
          Работает без компьютера: всё считается и хранится в этом браузере. Чтобы не потерять портрет или перенести его
          на компьютер — «Сохранить файл проекта» в студии.
        </p>
      )}
      {/* Страница */}
      {children}
      {/* Подсказка о долгом расчёте */}
      {note && (
        // Плашка внизу экрана
        <div className="local-note" role="status" data-testid="local-note">
          {/* Текст */}
          {note}
        </div>
      )}
    </>
  );
}
