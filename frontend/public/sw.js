// «Нитеграф» без компьютера: service worker версии для телефона (GitHub Pages).
// 1) Запросы /api/* передаёт странице, а она — Web Worker с «сервером» (lib/local).
// 2) Хранит файлы сайта в кэше — после первого открытия всё работает без интернета.
// Строки BUILD и PRECACHE подставляет scripts/pages-postbuild.mjs после сборки.

// Номер сборки (меняется — браузер ставит новый service worker)
const BUILD = "dev";
// Файлы сайта для кэша (пути от корня сайта)
const PRECACHE = [];
// Имя кэша этой сборки
const CACHE = `nitegraf-${BUILD}`;
// Корень сайта, например /string_art/
const SCOPE = new URL(self.registration.scope).pathname;

// Установка: кладём файлы сайта в кэш
self.addEventListener("install", (event) => {
  // Не заканчивать установку, пока не скачали
  event.waitUntil(
    // Асинхронно
    (async () => {
      // Кэш этой сборки
      const cache = await caches.open(CACHE);
      // Каждый файл (неудача одного не ломает установку)
      await Promise.all(PRECACHE.map((path) => cache.add(SCOPE + path).catch(() => null)));
      // Сразу становимся активными
      await self.skipWaiting();
    // Запускаем сразу
    })(),
  );
});

// Активация: убираем старые кэши (кроме предыдущего — открытые вкладки ещё могут к нему обратиться)
self.addEventListener("activate", (event) => {
  // Ждём уборки
  event.waitUntil(
    // Асинхронно
    (async () => {
      // Наши кэши по порядку создания
      const ours = (await caches.keys()).filter((k) => k.startsWith("nitegraf-") && k !== CACHE);
      // Все, кроме последнего прежнего, удаляем
      await Promise.all(ours.slice(0, -1).map((k) => caches.delete(k)));
      // Берём под управление открытые страницы
      await self.clients.claim();
    // Запускаем сразу
    })(),
  );
});

// Страница просит взять её под управление (после жёсткой перезагрузки)
self.addEventListener("message", (event) => {
  // Наша просьба
  if (event.data && event.data.type === "nitegraf-claim") event.waitUntil(self.clients.claim());
});

// Ответ JSON с ошибкой
function failure(status, detail) {
  // Как у бэкенда: {"detail": "…"}
  return new Response(JSON.stringify({ detail }), { status, headers: { "Content-Type": "application/json" } });
}

// Передать запрос /api/* странице и дождаться ответа «сервера»
async function relay(event) {
  // Страница, которая спрашивает (или любая открытая)
  const client = (event.clientId && (await self.clients.get(event.clientId))) || (await self.clients.matchAll({ type: "window" }))[0];
  // Открытых страниц нет
  if (!client) return failure(503, "Откройте «Нитеграф» заново");
  // Запрос
  const req = event.request;
  // Тело (у GET его нет)
  const body = req.method === "GET" || req.method === "HEAD" ? null : await req.arrayBuffer();
  // Канал для ответа
  const channel = new MessageChannel();
  // Ответ придёт в первый порт
  const answer = new Promise((resolve) => {
    // Сообщение с ответом
    channel.port1.onmessage = (e) => resolve(e.data);
  });
  // Отправляем странице: адрес, метод, заголовки, тело и второй порт
  client.postMessage({ type: "nitegraf-api", url: req.url, method: req.method, headers: [...req.headers.entries()], body }, body ? [channel.port2, body] : [channel.port2]);
  // Ждём ответ
  const res = await answer;
  // Ответ браузеру
  return new Response(res.body, { status: res.status, headers: res.headers });
}

// Файл сайта: страницы — сначала из сети (свежая версия), остальное — сначала из кэша
async function asset(req) {
  // Кэш этой сборки
  const cache = await caches.open(CACHE);
  // Переход на страницу
  if (req.mode === "navigate") {
    // Сеть может быть недоступна
    try {
      // Из сети
      const fresh = await fetch(req);
      // Удачный ответ — в кэш
      if (fresh.ok) cache.put(req, fresh.clone());
      // Отдаём
      return fresh;
      // Нет сети
    } catch {
      // Страница из кэша (параметры ?id=… не важны)
      const cached = (await caches.match(req, { ignoreSearch: true })) || (await caches.match(SCOPE, { ignoreSearch: true }));
      // Нашли — отдаём
      if (cached) return cached;
      // Нет — ошибка
      return failure(503, "Нет интернета, а эта страница ещё не сохранена");
    }
  }
  // Уже в кэше (в любом из наших)
  const cached = await caches.match(req);
  // Отдаём
  if (cached) return cached;
  // Сеть может быть недоступна
  try {
    // Из сети
    const fresh = await fetch(req);
    // Удачный ответ — в кэш
    if (fresh.ok) cache.put(req, fresh.clone());
    // Отдаём
    return fresh;
    // Нет сети
  } catch {
    // Тот же файл с другими параметрами (данные переходов Next.js: index.txt?_rsc=…)
    const similar = await caches.match(req, { ignoreSearch: true });
    // Нашли — отдаём
    if (similar) return similar;
    // Нет — ошибка
    return failure(503, "Нет интернета, а этот файл ещё не сохранён");
  }
}

// Все запросы сайта
self.addEventListener("fetch", (event) => {
  // Адрес
  const url = new URL(event.request.url);
  // Чужие сайты (шрифты, музыка, GitHub) — как обычно
  if (url.origin !== self.location.origin) return;
  // API — «серверу» в браузере
  if (url.pathname.startsWith(SCOPE + "api/")) return event.respondWith(relay(event));
  // Остальное, только чтение — из кэша или сети
  if (event.request.method === "GET") event.respondWith(asset(event.request));
});
