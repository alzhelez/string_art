// Показать собранную версию для телефона так, как её отдаёт GitHub Pages: сайт в /string_art/.
// Запуск: npm run serve:pages (порт — переменная PORT, по умолчанию 3002). Нужен для
// проверки на компьютере и для сквозных тестов Playwright версии для телефона.

// Файлы
import fs from "node:fs";
// HTTP-сервер
import http from "node:http";
// Пути
import path from "node:path";

// Папка сборки
const root = path.resolve(process.argv[2] ?? "out");
// Адрес сайта
const base = process.env.PAGES_BASE_PATH ?? "/string_art";
// Порт
const port = Number(process.env.PORT ?? 3002);
// Типы файлов по расширению
const TYPES = {
  // Страницы
  ".html": "text/html; charset=utf-8",
  // Скрипты
  ".js": "text/javascript; charset=utf-8",
  // Стили
  ".css": "text/css; charset=utf-8",
  // Данные
  ".json": "application/json",
  // Манифест
  ".webmanifest": "application/manifest+json",
  // Картинки
  ".png": "image/png",
  // Векторные
  ".svg": "image/svg+xml",
  // Значок
  ".ico": "image/x-icon",
  // Шрифты
  ".woff2": "font/woff2",
  // Шрифты
  ".woff": "font/woff",
  // Данные навигации Next.js
  ".txt": "text/plain; charset=utf-8",
};

// Сервер
http
  // Обработчик запросов
  .createServer((req, res) => {
    // Путь без параметров
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    // Корень домена — на сайт
    if (url === "/" || url === base) {
      // Перенаправление
      res.writeHead(301, { Location: `${base}/` });
      // Конец
      return res.end();
    }
    // Чужой путь
    if (!url.startsWith(`${base}/`)) {
      // 404
      res.writeHead(404);
      // Конец
      return res.end("Not found");
    }
    // Путь внутри папки
    let file = path.join(root, url.slice(base.length));
    // Выход за пределы папки запрещён
    if (!file.startsWith(root)) {
      // 403
      res.writeHead(403);
      // Конец
      return res.end();
    }
    // Папка — её index.html
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    // Папка без косой черты в конце — как GitHub Pages: перенаправление
    else if (!fs.existsSync(file) && fs.existsSync(path.join(file, "index.html"))) {
      // Со слэшем и теми же параметрами
      res.writeHead(301, { Location: `${url}/${(req.url ?? "").includes("?") ? "?" + (req.url ?? "").split("?")[1] : ""}` });
      // Конец
      return res.end();
    }
    // Нет файла
    if (!fs.existsSync(file)) {
      // 404
      res.writeHead(404);
      // Конец
      return res.end("Not found");
    }
    // Тип по расширению
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    // Содержимое
    fs.createReadStream(file).pipe(res);
  })
  // Слушаем
  .listen(port, "127.0.0.1", () => console.log(`Версия для телефона: http://127.0.0.1:${port}${base}/`));
