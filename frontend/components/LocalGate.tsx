// Компонент работает в браузере
"use client";

// Текущий адрес страницы
import { usePathname } from "next/navigation";
// Состояние и эффекты React
import { useEffect, useState } from "react";
// Запуск версии для телефона и подсказки о ходе расчёта
import { LOCAL_MODE, onProgress, startLocal } from "@/lib/local/client";

/**
 * Версия для телефона: пока не запущен «сервер» в браузере (service worker + Web Worker),
 * страницы не показываем — их запросы к /api/* некому было бы обработать.
 * В обычной версии и в программе для Windows просто показывает содержимое.
 */
// Ворота версии для телефона
export function LocalGate({ children }: { children: React.ReactNode }) {
  // Готово ли (обычная версия — сразу)
  const [ready, setReady] = useState(!LOCAL_MODE);
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
    // Подписка на подсказки
    const off = onProgress(setNote);
    // Запускаем
    startLocal()
      // Готово
      .then(() => setReady(true))
      // Не получилось
      .catch((e: Error) => setError(e.message));
    // При уходе — отписка
    return off;
    // [] — один раз
  }, []);

  // Ошибка запуска
  if (error) {
    // Сообщение вместо страницы
    return (
      // Блок ошибки
      <div className="local-gate" role="alert">
        {/* Заголовок */}
        <h1>Не получилось запустить «Нитеграф»</h1>
        {/* Причина */}
        <p>{error}</p>
      </div>
    );
  }
  // Ещё запускается
  if (!ready) {
    // Заставка
    return (
      // Блок ожидания
      <div className="local-gate" role="status" data-testid="local-starting">
        {/* Текст */}
        <p>Запускаем «Нитеграф» в браузере…</p>
      </div>
    );
  }
  // Готово
  return (
    // Без лишней обёртки
    <>
      {/* На главной версии для телефона — коротко, где хранятся портреты */}
      {LOCAL_MODE && path === "/" && (
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
