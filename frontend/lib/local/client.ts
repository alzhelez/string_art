// Версия для телефона: запуск на странице — service worker и Web Worker с «сервером».
// Service worker перехватывает запросы /api/* и присылает их сюда; страница передаёт
// их воркеру вместе с портом для ответа.

// Признак сборки для телефона (GitHub Pages): задаётся в next.config.ts
export const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL === "1";
// Адрес сайта (например, /string_art) — для service worker и запросов
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Подписчики на подсказки о ходе расчёта
const listeners = new Set<(note: string | null) => void>();

/** Подписаться на подсказки «Считаем нить 2 из 3…». Возвращает отписку. */
export function onProgress(fn: (note: string | null) => void): () => void {
  // Добавляем
  listeners.add(fn);
  // Отписка
  return () => listeners.delete(fn);
}

// Запуск выполняется один раз
let started: Promise<void> | null = null;

/** Включить работу без компьютера: зарегистрировать service worker и поднять воркер. */
export function startLocal(): Promise<void> {
  // Уже запущено
  if (started) return started;
  // Запуск
  started = (async () => {
    // Без service worker не получится
    if (!("serviceWorker" in navigator)) throw new Error("Этот браузер не умеет работать без сервера. Откройте сайт в свежем Chrome, Safari или Firefox.");
    // Воркер с «сервером» (сборщик сам положит файл рядом со страницей)
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    // Сообщения воркера: подсказки и предупреждения
    worker.onmessage = (e) => {
      // Подсказка о ходе расчёта или предупреждение
      if (e.data?.type === "nitegraf-progress" || e.data?.type === "nitegraf-warning") listeners.forEach((fn) => fn(e.data.note));
    };
    // Запросы от service worker → воркеру (порт для ответа передаём дальше)
    navigator.serviceWorker.addEventListener("message", (e) => {
      // Только наши
      if (e.data?.type !== "nitegraf-api") return;
      // Передаём тело без копирования
      worker.postMessage(e.data, [e.ports[0], ...(e.data.body ? [e.data.body] : [])]);
    });
    // Сообщения начинают приходить сразу (они копились до подписки)
    navigator.serviceWorker.startMessages();
    // Регистрируем service worker на весь сайт
    const reg = await navigator.serviceWorker.register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` });
    // Страница уже под его управлением — готово
    if (navigator.serviceWorker.controller) return;
    // Ждём, пока он возьмёт страницу под управление
    await new Promise<void>((resolve) => {
      // Взял — готово
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
      // Уже активен (например, после жёсткой перезагрузки) — просим взять страницу
      reg.active?.postMessage({ type: "nitegraf-claim" });
      // Только установился — попросит сам при активации
      if (navigator.serviceWorker.controller) resolve();
    });
  })();
  // Обещание запуска
  return started;
}
