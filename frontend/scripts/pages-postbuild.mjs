// После сборки версии для телефона (npm run build:pages): готовим папку out/ к GitHub Pages.
// 1) Вписываем в out/sw.js номер сборки и список файлов — service worker сохранит их
//    в кэш, и после первого открытия сайт работает без интернета.
// 2) Кладём .nojekyll — иначе GitHub Pages прячет папку _next.

// Хэш содержимого — номер сборки
import { createHash } from "node:crypto";
// Файлы
import fs from "node:fs";
// Пути
import path from "node:path";

// Папка сборки (можно передать первым аргументом)
const out = path.resolve(process.argv[2] ?? "out");
// Файл service worker
const sw = path.join(out, "sw.js");
// Без него сборка испорчена
if (!fs.existsSync(sw)) throw new Error(`Нет ${sw} — сначала npm run build:pages`);

// Все файлы папки (пути через «/» от корня сайта)
function walk(dir, prefix = "") {
  // Содержимое папки
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    // Папка — внутрь, файл — путь
    e.isDirectory() ? walk(path.join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
  );
}

// Что кэшировать: всё, кроме самого service worker, служебных файлов и карт исходников
const files = walk(out)
  // Отбор
  .filter((f) => f !== "sw.js" && f !== ".nojekyll" && !f.endsWith(".map"))
  // Страницы index.html кэшируем по адресу папки («project/» вместо «project/index.html»)
  .map((f) => (f === "index.html" ? "" : f.endsWith("/index.html") ? f.slice(0, -"index.html".length) : f))
  // По алфавиту — одинаковый порядок при одинаковой сборке
  .sort();

// Хэш всех файлов
const hash = createHash("sha256");
// Каждый файл
for (const f of walk(out).filter((x) => x !== "sw.js").sort()) {
  // Имя
  hash.update(f);
  // Содержимое
  hash.update(fs.readFileSync(path.join(out, f)));
}
// Первые 12 знаков
const build = hash.digest("hex").slice(0, 12);

// Текст service worker
let text = fs.readFileSync(sw, "utf8");
// Строки, которые заменяем
const marks = ['const BUILD = "dev";', "const PRECACHE = [];"];
// Обе должны быть на месте
for (const m of marks) if (!text.includes(m)) throw new Error(`В sw.js нет строки ${m}`);
// Номер сборки
text = text.replace(marks[0], `const BUILD = ${JSON.stringify(build)};`);
// Список файлов
text = text.replace(marks[1], `const PRECACHE = ${JSON.stringify(files)};`);
// Записываем
fs.writeFileSync(sw, text);
// Без Jekyll — папка _next видна
fs.writeFileSync(path.join(out, ".nojekyll"), "");
// Итог в журнал сборки
console.log(`Версия для телефона: сборка ${build}, файлов в кэше: ${files.length}`);
