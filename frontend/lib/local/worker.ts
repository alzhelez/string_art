// Версия для телефона: Web Worker, в котором работает «сервер» (расчёты не подвешивают страницу).
// Service worker перехватывает запросы /api/* и через страницу передаёт сюда вместе
// с портом для ответа; ответ уходит прямо в service worker.

// Кодек браузера
import { browserCodec } from "./codec";
// Сервер
import { LocalServer } from "./server";
// Хранилища
import { IdbStore, MemoryStore, type Store } from "./store";

// Запрос от service worker
interface ApiMessage {
  // Метка
  type: "nitegraf-api";
  // Полный адрес
  url: string;
  // Метод
  method: string;
  // Заголовки
  headers: [string, string][];
  // Тело (или null)
  body: ArrayBuffer | null;
}

// Контекст воркера (типы DOM описывают окно, а не воркер — уточняем нужное)
const ctx = self as unknown as {
  // Отправить сообщение странице
  postMessage(data: unknown): void;
  // Обработчик сообщений
  onmessage: ((e: MessageEvent<ApiMessage>) => void) | null;
};

// Хранилище: IndexedDB, а если браузер её не даёт (старый приватный режим) — память
function openStore(): Store {
  // IndexedDB может отсутствовать
  try {
    // Есть — постоянное хранилище
    if (typeof indexedDB !== "undefined") return new IdbStore();
    // Нет IndexedDB
  } catch {
    /* ниже — память */
  }
  // Сообщаем странице: портреты не сохранятся после закрытия
  ctx.postMessage({ type: "nitegraf-warning", note: "Браузер не даёт сохранять данные — портреты пропадут после закрытия страницы. Сохраняйте файл проекта." });
  // Память
  return new MemoryStore();
}

// Сервер: хранилище, кодек и сообщения о ходе расчёта
const server = new LocalServer(openStore(), browserCodec, (note) => ctx.postMessage({ type: "nitegraf-progress", note }));

// Запрос от service worker
ctx.onmessage = async (e) => {
  // Только наши сообщения
  if (e.data?.type !== "nitegraf-api") return;
  // Порт для ответа
  const port = e.ports[0];
  // Запрос (тело — только у методов, где оно бывает)
  const req = new Request(e.data.url, { method: e.data.method, headers: e.data.headers, body: e.data.body && e.data.method !== "GET" && e.data.method !== "HEAD" ? e.data.body : undefined });
  // Ответ сервера
  const res = await server.handle(req);
  // Тело ответа
  const body = res.status === 204 ? null : await res.arrayBuffer();
  // Расчёт закончен — подсказку убрать
  ctx.postMessage({ type: "nitegraf-progress", note: null });
  // Ответ в service worker (тело передаём без копирования)
  port.postMessage({ status: res.status, headers: [...res.headers.entries()], body }, body ? [body] : []);
};
