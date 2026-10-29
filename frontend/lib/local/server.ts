// Версия для телефона: «сервер» внутри браузера — те же адреса /api/*, что у Python-бэкенда.
// Запросы страницы перехватывает service worker и передаёт сюда (в Web Worker), так что
// интерфейс работает как обычно, а портреты считаются и хранятся прямо в телефоне.
// Чего нет без компьютера: поиск лица, удаление фона, PDF-инструкция и шаблон.

// Ограничения из настроек
import {
  // Катушки, диаметр, скорость, линии
  BIG_SPOOL_M, DEFAULT_DIAMETER_CM, DEFAULT_SPEED_SEC, DIAMETER_PRESETS_CM, LINES_PER_CM, MAX_DIAMETER_CM, MAX_LINES, MAX_SPEED_SEC,
  // Пределы диаметра, линий, скорости; гвозди, сектора, катушки
  MIN_DIAMETER_CM, MIN_LINES, MIN_SPEED_SEC, NAILS_PER_SECTOR, SECTORS, SPEED_STEP_SEC, STANDARD_SPOOLS_M, THREAD_DIAMETER_MM,
  // Гвозди и запас лески
  THREAD_MARGIN, TOTAL_NAILS,
} from "../constants";
// Подписи гвоздей и шаг по дуге
import { arcSpacing, nailLabel } from "../nails";
// Кадр, коррекции тона
import { clampPrep, cropBox, DEFAULT_PREP, processColor, processGray, toGray, type Prep } from "../prep";
// Длина лески и катушка
import { cumulativeLengthsM, recommendedLines, threadStats } from "../thread";
// Расчёт схемы и карта цели
import { generateSequence, PROCESSING_SIZE, targetMap } from "./algorithm";
// Кодек картинок
import { ImageError, type Bitmap, type Codec } from "./codec";
// Цветные нити
import { BOARD_BY_KEY, boardRgb, buildLayers, catalog, DEFAULT_BOARD, DEFAULT_COLORS, layerCurve, LAYER_MIN_LINES, MAX_COLORS, MIN_COLORS, MODES, resolvePalette, THREAD_BY_KEY, threadRgb, type Mode } from "./colors";
// Картинка готовой картины
import { renderLayers } from "./render";
// Сходство и автонастройка
import { autoTone, bestPoint, similarityCurve } from "./similarity";
// Хранилище
import type { ImageRow, ProjectRow, Store, StoredLayer } from "./store";
// Файл проекта
import { EXTENSION, FORMAT, fromB64, parseTransfer, toB64, TransferError, VERSION } from "./transfer";

// Версия «программы» в телефоне
export const LOCAL_VERSION = "phone";
// Самый большой загружаемый файл, как на бэкенде
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
// Самая большая маска
const MAX_MASK_BYTES = 8 * 1024 * 1024;
// id — 12 шестнадцатеричных знаков
const ID_RE = /^[0-9a-f]{12}$/;
// Через сколько неиспользованное фото удаляется (сутки)
const ORPHAN_MS = 24 * 60 * 60 * 1000;
// Почему нет удаления фона
const NO_BACKGROUND = "В версии для телефона фон не убирается — это умеет программа на компьютере. Откройте там файл проекта.";
// Почему нет PDF
const NO_PDF = "PDF-инструкция и шаблон есть в программе на компьютере — сохраните файл проекта и откройте его там.";

/** Ошибка с кодом ответа (как HTTPException). */
export class HttpError extends Error {
  // Код
  status: number;
  // Создание
  constructor(status: number, detail: string) {
    // Текст
    super(detail);
    // Код
    this.status = status;
  }
}

// Ответ JSON
function json(data: unknown, status = 200): Response {
  // Тело и тип
  return new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

// Ответ с байтами
function bytes(data: Uint8Array, type: string, headers: Record<string, string> = {}): Response {
  // Тело и тип
  return new Response(data as BodyInit, { headers: { "Content-Type": type, ...headers } });
}

// Сейчас в ISO с точностью до секунды, как на бэкенде
function nowIso(): string {
  // 2026-10-29T12:00:00+00:00
  return new Date().toISOString().slice(0, 19) + "+00:00";
}

// Новый id из 12 знаков
function newId(): string {
  // 6 случайных байт
  const b = crypto.getRandomValues(new Uint8Array(6));
  // В шестнадцатеричный вид
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

// Короткий отпечаток схемы (для кэша кривых)
function hashOf(values: ArrayLike<number>): string {
  // FNV-1a
  let h = 2166136261;
  // Каждое число
  for (let i = 0; i < values.length; i++) h = Math.imul(h ^ values[i], 16777619) >>> 0;
  // Строка
  return h.toString(16);
}

// Название по умолчанию: «Портрет от 29.10.2026»
function defaultName(): string {
  // Дата по-русски
  const d = new Date();
  // День.месяц.год
  return `Портрет от ${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

// Название из имени файла без расширения
function nameFromFile(filename: string | null | undefined): string {
  // Без расширения
  const stem = (filename ?? "").trim().replace(/\.[A-Za-z0-9]{2,5}$/, "");
  // Не длиннее 100 или по умолчанию
  return stem.slice(0, 100) || defaultName();
}

// Объект ли
function isObj(v: unknown): v is Record<string, unknown> {
  // Проверка
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Лишние поля запрещены (как extra="forbid")
function onlyFields(o: Record<string, unknown>, allowed: string[]): void {
  // Лишние
  const extra = Object.keys(o).filter((k) => !allowed.includes(k));
  // Есть — ошибка
  if (extra.length) throw new HttpError(422, `Лишние поля: ${extra.join(", ")}`);
}

// Число в пределах (или undefined, если поля нет)
function numField(o: Record<string, unknown>, key: string, lo: number, hi: number, integer = false): number | undefined {
  // Значение
  const v = o[key];
  // Нет поля
  if (v === undefined || v === null) return undefined;
  // Не число или не целое
  if (typeof v !== "number" || !Number.isFinite(v) || (integer && !Number.isInteger(v))) throw new HttpError(422, `Поле ${key}: нужно ${integer ? "целое " : ""}число`);
  // Вне пределов
  if (v < lo || v > hi) throw new HttpError(422, `Поле ${key}: от ${lo} до ${hi}`);
  // Число
  return v;
}

// Параметры кадра из запроса (как PrepIn)
function prepIn(v: unknown, extraAllowed: string[] = []): Prep {
  // Нет — по умолчанию
  if (v === undefined || v === null) return { ...DEFAULT_PREP };
  // Не объект
  if (!isObj(v)) throw new HttpError(422, "Параметры кадра должны быть объектом");
  // Лишние поля
  onlyFields(v, [...Object.keys(DEFAULT_PREP), ...extraAllowed]);
  // Поля с пределами
  const p: Prep = {
    // Центр по X
    center_x: numField(v, "center_x", 0, 1) ?? 0.5,
    // Центр по Y
    center_y: numField(v, "center_y", 0, 1) ?? 0.5,
    // Зум
    zoom: numField(v, "zoom", 1, 4) ?? 1,
    // Яркость
    brightness: numField(v, "brightness", -0.5, 0.5) ?? 0,
    // Контраст
    contrast: numField(v, "contrast", -0.5, 1) ?? 0,
    // Убрать фон
    remove_background: Boolean(v.remove_background),
    // Выделить лицо
    face_focus: Boolean(v.face_focus),
  };
  // С ограничениями
  return clampPrep(p);
}

// Учёт времени для ответа
function activityOut(log: Record<string, [number, number]>) {
  // Дни по порядку
  const days = Object.entries(log)
    // Сортировка по дате
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    // В вид ответа
    .map(([date, [sec, steps]]) => ({ date, sec, steps }));
  // Итог
  return {
    // Всего секунд
    total_sec: Math.round(days.reduce((s, d) => s + d.sec, 0) * 10) / 10,
    // Всего шагов
    total_steps: days.reduce((s, d) => s + d.steps, 0),
    // Последние 60 дней
    days: days.slice(-60),
  };
}

// Слои портрета (одна нить — тоже «слой»)
function layersOf(p: ProjectRow): StoredLayer[] {
  // Цветной — свои слои
  if (p.layers.length) return p.layers;
  // Одна чёрная нить
  return [{ color: "black", sequence: p.sequence, line_count: p.line_count, current_step: p.current_step }];
}

// Портрет для списка (как _summary)
function summary(p: ProjectRow) {
  // Все поля, кроме схемы и слоёв
  const rest: Record<string, unknown> = { ...p };
  // Схема — только в полном виде
  delete rest.sequence;
  // Слои — отдельно ниже
  delete rest.layers;
  // Ответ
  return {
    // Все поля строки
    ...rest,
    // Расход лески
    stats: threadStats(p.sequence, p.line_count, p.diameter_cm),
    // Учёт времени
    activity: activityOut(p.activity),
    // Режим
    mode: p.mode || "mono",
    // Доска
    board: { ...(BOARD_BY_KEY.get(p.board) ?? BOARD_BY_KEY.get("white")!) },
    // Слои
    layers: layersOf(p).map((l, i) => ({
      // Номер
      index: i,
      // Ключ нити
      color: l.color,
      // Название
      name: THREAD_BY_KEY.get(l.color)!.name,
      // Цвет
      hex: THREAD_BY_KEY.get(l.color)!.hex,
      // Линий
      line_count: l.line_count,
      // Шаг
      current_step: l.current_step,
      // Леска этой нити
      stats: threadStats(l.sequence, l.line_count, p.diameter_cm),
    })),
  };
}

// Портрет целиком (как _detail)
function detail(p: ProjectRow) {
  // Сводка
  const out = summary(p);
  // Со схемой и схемами слоёв
  return { ...out, sequence: p.sequence, layers: out.layers.map((l, i) => ({ ...l, sequence: layersOf(p)[i].sequence })) };
}

// Фото для ответа (как _image_out)
function imageOut(i: ImageRow) {
  // Поля; лиц в телефоне не ищем
  return { id: i.id, width: i.width, height: i.height, faces: i.faces, has_mask: Boolean(i.mask) };
}

// Состояние маски: есть — готова, нет — убрать фон нельзя
function maskStatus(i: ImageRow) {
  // Нет маски
  if (!i.mask) throw new HttpError(503, NO_BACKGROUND);
  // Готова
  return { status: "ready", model: "idle", message: null, edited: i.mask_source === "edited", progress: null };
}

/** Результат расчёта портрета. */
interface Generated {
  // Схема первого слоя
  sequence: number[];
  // Линий первого слоя
  line_count: number;
  // Подготовленное фото (PNG)
  source_png: Uint8Array;
  // Режим
  mode: string;
  // Доска
  board: string;
  // Слои
  layers: StoredLayer[];
}

/** «Сервер» в браузере. */
export class LocalServer {
  // Хранилище
  private store: Store;
  // Кодек
  private codec: Codec;
  // Сообщение о ходе долгих расчётов
  private progress: (note: string) => void;
  // Открытые картинки (последние две)
  private bitmaps = new Map<string, Bitmap>();
  // Кэш кривых сходства
  private curves = new Map<string, unknown>();
  // Очередь изменений: записи идут строго по одной
  private queue: Promise<unknown> = Promise.resolve();

  // Создание
  constructor(store: Store, codec: Codec, progress: (note: string) => void = () => {}) {
    // Хранилище
    this.store = store;
    // Кодек
    this.codec = codec;
    // Сообщения
    this.progress = progress;
  }

  /** Ответить на запрос страницы. */
  async handle(req: Request): Promise<Response> {
    // Любая ошибка — ответ с кодом
    try {
      // Обработка
      return await this.route(req);
      // Ошибка
    } catch (e) {
      // Наша — с кодом
      if (e instanceof HttpError || e instanceof TransferError) return json({ detail: e.message }, e.status);
      // Не картинка
      if (e instanceof ImageError) return json({ detail: e.message }, 400);
      // Непредвиденная — 500 с причиной
      return json({ detail: `Ошибка в телефоне: ${(e as Error).message}` }, 500);
    }
  }

  // Выполнить изменение после предыдущих (без гонок между PATCH и учётом времени)
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    // Следующее звено очереди
    const next = this.queue.then(fn, fn);
    // Очередь не должна «ломаться» от ошибок
    this.queue = next.catch(() => undefined);
    // Результат
    return next;
  }

  // Разбор адреса и выбор обработчика
  private async route(req: Request): Promise<Response> {
    // Адрес
    const url = new URL(req.url);
    // Путь от /api/ (перед ним может быть адрес сайта, например /string_art)
    const path = url.pathname.slice(url.pathname.indexOf("/api/"));
    // Метод
    const m = req.method;
    // Параметры адреса
    const q = url.searchParams;
    // Части пути
    const parts = path.split("/").filter(Boolean);
    // Сервер жив
    if (path === "/api/health") return json({ status: "ok" });
    // Настройки
    if (path === "/api/config") return json(this.config());
    // Обновление в одну кнопку — только в программе для Windows
    if (path === "/api/update") {
      // Начать нельзя
      if (m === "POST") throw new HttpError(404, "Обновление в одну кнопку есть только в программе для Windows");
      // Состояние
      return json({ state: "idle", version: null, done: 0, total: 0, error: null, supported: false });
    }
    // Справка по диаметру
    if (path === "/api/geometry") return json(this.geometry(q));
    // Шаблон без проекта
    if (path === "/api/template.pdf") throw new HttpError(404, NO_PDF);
    // Список портретов
    if (path === "/api/projects" && m === "GET") return json(await this.list());
    // Новый портрет из файла
    if (path === "/api/projects" && m === "POST") return json(await this.createFromUpload(req), 201);
    // Новый портрет из загруженного фото
    if (path === "/api/projects/from-image" && m === "POST") return json(await this.createFromImage(await this.body(req)), 201);
    // Открыть файл проекта
    if (path === "/api/projects/import" && m === "POST") return json(await this.importFile(req), 201);
    // Загрузка фото
    if (path === "/api/images" && m === "POST") return json(await this.uploadImage(req), 201);
    // Адреса фото: /api/images/{id}/…
    if (parts[1] === "images" && parts[2]) return this.imageRoute(m, parts[2], parts.slice(3).join("/"), req, q);
    // Адреса портрета: /api/projects/{id}/…
    if (parts[1] === "projects" && parts[2]) return this.projectRoute(m, parts[2], parts.slice(3).join("/"), req, q);
    // Неизвестный адрес
    throw new HttpError(404, "Не найдено");
  }

  // Тело запроса JSON
  private async body(req: Request): Promise<Record<string, unknown>> {
    // Разбор
    let data: unknown;
    // Может быть не JSON
    try {
      // JSON
      data = await req.json();
      // Не JSON
    } catch {
      // Ошибка
      throw new HttpError(422, "Тело запроса должно быть JSON");
    }
    // Не объект
    if (!isObj(data)) throw new HttpError(422, "Тело запроса должно быть объектом");
    // Объект
    return data;
  }

  // Файл из формы
  private async file(req: Request, max: number, tooBig: string): Promise<{ bytes: Uint8Array; name: string; form: FormData }> {
    // Форма
    let form: FormData;
    // Может быть не форма
    try {
      // Разбор
      form = await req.formData();
      // Не форма
    } catch {
      // Ошибка
      throw new HttpError(422, "Нужна форма с файлом");
    }
    // Поле file
    const f = form.get("file");
    // Нет файла
    if (!f || typeof f === "string") throw new HttpError(422, "Нет файла в поле file");
    // Слишком большой
    if (f.size > max) throw new HttpError(413, tooBig);
    // Байты, имя, форма
    return { bytes: new Uint8Array(await f.arrayBuffer()), name: (f as File).name ?? "", form };
  }

  // Настройки для фронтенда
  private config() {
    // Как /api/config бэкенда
    return {
      // Сектора
      sectors: [...SECTORS],
      // Гвоздей в секторе
      nails_per_sector: NAILS_PER_SECTOR,
      // Всего гвоздей
      total_nails: TOTAL_NAILS,
      // Стартовый гвоздь
      start_nail: 0,
      // Число линий
      lines: { min: MIN_LINES, max: MAX_LINES, per_cm: LINES_PER_CM },
      // Диаметр
      diameter: { presets_cm: [...DIAMETER_PRESETS_CM], default_cm: DEFAULT_DIAMETER_CM, min_cm: MIN_DIAMETER_CM, max_cm: MAX_DIAMETER_CM },
      // Леска
      thread: { diameter_mm: THREAD_DIAMETER_MM, margin: THREAD_MARGIN, spools_m: [...STANDARD_SPOOLS_M], big_spool_m: BIG_SPOOL_M },
      // Скорость
      speed: { default_sec: DEFAULT_SPEED_SEC, step_sec: SPEED_STEP_SEC, min_sec: MIN_SPEED_SEC, max_sec: MAX_SPEED_SEC },
      // Предел загрузки
      max_upload_bytes: MAX_UPLOAD_BYTES,
      // «Программа»: версия для телефона
      app: { version: LOCAL_VERSION, desktop: false, update: false },
      // Возможности: без лица, фона и PDF; local — всё считается в телефоне
      features: { face_detection: false, background_removal: false, pdf: false, local: true },
      // Модели удаления фона нет
      background: { installed: false, state: "idle", error: null, progress: null },
      // Нити и доски
      palette: catalog(),
    };
  }

  // Справка по диаметру
  private geometry(q: URLSearchParams) {
    // Диаметр
    const d = Number(q.get("diameter_cm"));
    // Вне пределов
    if (!Number.isFinite(d) || d < MIN_DIAMETER_CM || d > MAX_DIAMETER_CM) throw new HttpError(422, `Диаметр — от ${MIN_DIAMETER_CM} до ${MAX_DIAMETER_CM} см`);
    // Ответ
    return { diameter_cm: d, nail_spacing_mm: Math.round(arcSpacing(d * 10) * 100) / 100, recommended_lines: recommendedLines(d) };
  }

  // Все портреты, свежие сверху
  private async list() {
    // Убираем фото, которые так и не стали портретами
    await this.cleanImages();
    // Портреты
    const all = await this.store.listProjects();
    // Сортировка: изменённые недавно — первыми
    all.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : a.created_at < b.created_at ? 1 : -1));
    // Сводки
    return all.map(summary);
  }

  // Удалить фото старше суток без портрета
  private async cleanImages() {
    // Используемые фото
    const used = new Set((await this.store.listProjects()).map((p) => p.image_id));
    // Каждое фото
    for (const i of await this.store.listImages()) {
      // Старое и без портрета — удаляем
      if (!used.has(i.id) && Date.now() - Date.parse(i.created_at) > ORPHAN_MS) await this.store.deleteImage(i.id);
    }
  }

  // Портрет или 404
  private async project(id: string): Promise<ProjectRow> {
    // Неверный id
    if (!ID_RE.test(id)) throw new HttpError(404, "Проект не найден");
    // Из базы
    const p = await this.store.getProject(id);
    // Нет
    if (!p) throw new HttpError(404, "Проект не найден");
    // Портрет
    return p;
  }

  // Фото или 404
  private async image(id: string): Promise<ImageRow> {
    // Неверный id
    if (!ID_RE.test(id)) throw new HttpError(404, "Фото не найдено");
    // Из базы
    const i = await this.store.getImage(id);
    // Нет
    if (!i) throw new HttpError(404, "Фото не найдено");
    // Фото
    return i;
  }

  // Открыть картинку (последние две держим открытыми)
  private async bitmap(key: string, data: Uint8Array): Promise<Bitmap> {
    // Уже открыта
    const ready = this.bitmaps.get(key);
    // Отдаём
    if (ready) return ready;
    // Открываем
    const bmp = await this.codec.open(data);
    // Много открытых — закрываем самую старую
    if (this.bitmaps.size >= 2) {
      // Самая старая
      const [oldKey, old] = this.bitmaps.entries().next().value as [string, Bitmap];
      // Закрываем
      old.close();
      // Убираем
      this.bitmaps.delete(oldKey);
    }
    // Запоминаем
    this.bitmaps.set(key, bmp);
    // Картинка
    return bmp;
  }

  // Кадр фото и маски: пиксели RGBA и маска (0..255) или null
  private async frame(i: ImageRow, prep: Prep): Promise<{ rgba: Uint8ClampedArray; mask: Uint8Array | null }> {
    // Оригинал
    const bmp = await this.bitmap(`img:${i.id}`, i.original);
    // Кадр в пикселях оригинала
    const [x0, y0, side] = cropBox(i.width, i.height, prep);
    // Масштаб: картинка могла открыться другого размера
    const k = bmp.width / i.width;
    // Пиксели кадра
    const rgba = bmp.crop(x0 * k, y0 * k, side * k, PROCESSING_SIZE);
    // Фон не убираем — маска не нужна
    if (!prep.remove_background) return { rgba, mask: null };
    // Маски нет — убрать фон нельзя
    if (!i.mask) throw new HttpError(503, NO_BACKGROUND);
    // Маска (её размер может отличаться от фото)
    const mbmp = await this.bitmap(`mask:${i.id}:${hashOf(i.mask)}`, i.mask);
    // Масштаб маски
    const km = mbmp.width / i.width;
    // Пиксели маски
    const m = mbmp.crop(x0 * km, y0 * km, side * km, PROCESSING_SIZE);
    // Яркость маски (красный канал)
    const mask = new Uint8Array(PROCESSING_SIZE * PROCESSING_SIZE);
    // Каждая точка
    for (let p = 0; p < mask.length; p++) mask[p] = m[p * 4];
    // Кадр и маска
    return { rgba, mask };
  }

  // Подготовленное серое фото 400×400
  private async prepareGray(i: ImageRow, prep: Prep): Promise<Uint8ClampedArray> {
    // Кадр
    const { rgba, mask } = await this.frame(i, prep);
    // Серое → фон → автоуровни → яркость/контраст
    return processGray(toGray(rgba), prep, mask);
  }

  // Серое → PNG
  private async grayPng(gray: Uint8ClampedArray, size = PROCESSING_SIZE): Promise<Uint8Array> {
    // Пиксели RGBA
    const rgba = new Uint8ClampedArray(size * size * 4);
    // Каждая точка
    for (let p = 0; p < gray.length; p++) {
      // Три канала одинаковые
      rgba[p * 4] = rgba[p * 4 + 1] = rgba[p * 4 + 2] = gray[p];
      // Непрозрачно
      rgba[p * 4 + 3] = 255;
    }
    // PNG
    return this.codec.png(rgba, size, size);
  }

  // Расчёт портрета: подготовка фото, схема, рекомендуемое число линий
  private async generate(i: ImageRow, prep: Prep, mode: string, colors: string[] | null, colorCount: number, board: string | null, diameter: number): Promise<Generated> {
    // Лиц в телефоне не ищем
    if (prep.face_focus) throw new HttpError(422, "В версии для телефона нет «Выделить лицо» — снимите галочку");
    // Одна нить
    if (mode === "mono") {
      // Сообщение
      this.progress("Готовим фото…");
      // Серое фото
      const gray = await this.prepareGray(i, prep);
      // Сообщение
      this.progress("Считаем схему…");
      // Схема
      const sequence = generateSequence(targetMap(gray, PROCESSING_SIZE));
      // Сообщение
      this.progress("Подбираем число линий…");
      // Лучшее число линий
      const best = bestPoint(similarityCurve(sequence, Float32Array.from(gray), diameter))[0];
      // Итог
      return { sequence, line_count: best, source_png: await this.grayPng(gray), mode: "mono", board: "white", layers: [] };
    }
    // Доска
    const boardKey = board || DEFAULT_BOARD[mode as Mode];
    // Неизвестная
    if (!BOARD_BY_KEY.has(boardKey)) throw new HttpError(422, `Неизвестный цвет доски: ${boardKey}`);
    // Кадр
    const { rgba, mask } = await this.frame(i, prep);
    // Цвет доски в байтах
    const b255 = boardRgb(boardKey).map((v) => Math.round(v * 255)) as [number, number, number];
    // Цветное подготовленное фото, фон — цвета доски
    const color = processColor(rgba, prep, mask, b255);
    // Цвета точек в долях
    const target = new Float32Array(PROCESSING_SIZE * PROCESSING_SIZE * 3);
    // Каждая точка
    for (let p = 0; p < target.length / 3; p++) for (let c = 0; c < 3; c++) target[p * 3 + c] = color[p * 4 + c] / 255;
    // Какие нити
    let resolved: { keys: string[]; board: string };
    // Ошибки выбора — 422
    try {
      // Подбор
      resolved = resolvePalette(mode, colors, boardKey, target, PROCESSING_SIZE, colorCount);
      // Ошибка
    } catch (e) {
      // Понятный текст
      throw new HttpError(422, (e as Error).message);
    }
    // Слои
    const built = buildLayers(target, resolved.board, resolved.keys, null, diameter, PROCESSING_SIZE, this.progress);
    // Итог
    return {
      // Схема первого слоя
      sequence: built[0].sequence,
      // Линий первого слоя
      line_count: built[0].line_count,
      // Цветное подготовленное фото
      source_png: await this.codec.png(color, PROCESSING_SIZE, PROCESSING_SIZE),
      // Режим
      mode,
      // Доска
      board: resolved.board,
      // Слои с прогрессом
      layers: built.map((l) => ({ ...l, current_step: 1 })),
    };
  }

  // Сохранить новый портрет
  private async saveNew(fields: Partial<ProjectRow> & Pick<ProjectRow, "name" | "diameter_cm" | "line_count" | "sequence">, source: Uint8Array): Promise<ProjectRow> {
    // Сейчас
    const now = nowIso();
    // Строка базы
    const row: ProjectRow = {
      // id
      id: newId(),
      // Создан
      created_at: now,
      // Изменён
      updated_at: now,
      // Скорость
      speed_sec: DEFAULT_SPEED_SEC,
      // Шаг
      current_step: 1,
      // Фото
      image_id: null,
      // Кадр
      prep: {},
      // Катушка
      own_spool_m: null,
      // Учёт времени
      activity: {},
      // Режим
      mode: "mono",
      // Доска
      board: "white",
      // Слои
      layers: [],
      // Текущая нить
      current_layer: 0,
      // Переданные поля
      ...fields,
    };
    // Подготовленное фото
    await this.store.putSource(row.id, source);
    // Портрет
    await this.store.putProject(row);
    // Готово
    return row;
  }

  // Сохранить загруженное фото
  private async storeImage(data: Uint8Array): Promise<ImageRow> {
    // Поворот, белый фон, ≤ 1600 px, JPEG
    const norm = await this.codec.normalize(data);
    // Строка базы
    const row: ImageRow = { id: newId(), created_at: nowIso(), width: norm.width, height: norm.height, faces: [], original: norm.bytes, mask: null, mask_auto: null, mask_source: null };
    // Запись
    await this.store.putImage(row);
    // Фото
    return row;
  }

  // Загрузить фото (для редактора)
  private async uploadImage(req: Request) {
    // Файл
    const { bytes: data } = await this.file(req, MAX_UPLOAD_BYTES, "Файл слишком большой (максимум 15 МБ)");
    // Пустой
    if (!data.length) throw new HttpError(400, "Пустой файл");
    // Сохраняем
    return imageOut(await this.storeImage(data));
  }

  // Портрет из файла с параметрами по умолчанию
  private async createFromUpload(req: Request) {
    // Файл и форма
    const { bytes: data, name, form } = await this.file(req, MAX_UPLOAD_BYTES, "Файл слишком большой (максимум 15 МБ)");
    // Пустой
    if (!data.length) throw new HttpError(400, "Пустой файл");
    // Диаметр из формы
    const d = Number(form.get("diameter_cm") ?? DEFAULT_DIAMETER_CM);
    // Вне пределов
    if (!Number.isFinite(d) || d < MIN_DIAMETER_CM || d > MAX_DIAMETER_CM) throw new HttpError(422, `Диаметр — от ${MIN_DIAMETER_CM} до ${MAX_DIAMETER_CM} см`);
    // Название из формы или файла
    const title = String(form.get("name") ?? "").trim().slice(0, 100) || nameFromFile(name);
    // Фото
    const img = await this.storeImage(data);
    // Портрет
    return detail(await this.createFrom(img, title, d, { ...DEFAULT_PREP }));
  }

  // Портрет из загруженного фото
  private async createFromImage(b: Record<string, unknown>) {
    // Допустимые поля
    onlyFields(b, ["image_id", "name", "diameter_cm", "prep", "mode", "colors", "color_count", "board"]);
    // Фото
    const img = await this.image(String(b.image_id ?? ""));
    // Название
    const name = typeof b.name === "string" ? b.name.trim().slice(0, 100) : "";
    // Диаметр
    const d = numField(b, "diameter_cm", MIN_DIAMETER_CM, MAX_DIAMETER_CM) ?? DEFAULT_DIAMETER_CM;
    // Нити
    const t = this.threadsIn(b);
    // Портрет
    return detail(await this.createFrom(img, name || defaultName(), d, prepIn(b.prep), t.mode ?? "mono", t.colors, t.count ?? DEFAULT_COLORS, t.board));
  }

  // Параметры нитей из запроса
  private threadsIn(b: Record<string, unknown>): { mode: string | undefined; colors: string[] | null; count: number | undefined; board: string | null } {
    // Режим
    const mode = b.mode === undefined || b.mode === null ? undefined : String(b.mode);
    // Неизвестный
    if (mode !== undefined && !(MODES as readonly string[]).includes(mode)) throw new HttpError(422, `Неизвестный режим: ${mode}`);
    // Цвета
    const colors = Array.isArray(b.colors) ? b.colors.map(String) : null;
    // Слишком много
    if (colors && colors.length > MAX_COLORS) throw new HttpError(422, `Выберите от ${MIN_COLORS} до ${MAX_COLORS} цветов`);
    // Сколько подобрать
    const count = numField(b, "color_count", MIN_COLORS, MAX_COLORS, true);
    // Доска
    const board = typeof b.board === "string" && b.board ? b.board : null;
    // Параметры
    return { mode, colors, count, board };
  }

  // Посчитать и сохранить портрет
  private async createFrom(img: ImageRow, name: string, diameter: number, prep: Prep, mode = "mono", colors: string[] | null = null, count = DEFAULT_COLORS, board: string | null = null): Promise<ProjectRow> {
    // Расчёт
    const r = await this.generate(img, prep, mode, colors, count, board, diameter);
    // Сохраняем
    return this.saveNew({ name, diameter_cm: Math.round(diameter * 10) / 10, line_count: r.line_count, sequence: r.sequence, image_id: img.id, prep: { ...prep }, mode: r.mode, board: r.board, layers: r.layers }, r.source_png);
  }

  // Адреса фото
  private async imageRoute(m: string, id: string, rest: string, req: Request, q: URLSearchParams): Promise<Response> {
    // Сведения о фото
    if (rest === "" && m === "GET") return json(imageOut(await this.image(id)));
    // Оригинал
    if (rest === "original.jpg" && m === "GET") return bytes((await this.image(id)).original, "image/jpeg", { "Cache-Control": "max-age=86400" });
    // Состояние маски (запуск расчёта — тоже: маски без компьютера не бывает)
    if (rest === "mask" && (m === "GET" || m === "POST")) return json(maskStatus(await this.image(id)));
    // Маска
    if (rest === "mask.png" && m === "GET") {
      // Фото
      const i = await this.image(id);
      // Нет маски
      if (!i.mask) throw new HttpError(409, "Маски нет");
      // PNG
      return bytes(i.mask, "image/png", { "Cache-Control": "no-cache" });
    }
    // Маска, поправленная кистью
    if (rest === "mask.png" && m === "PUT") return json(await this.serial(() => this.putMask(id, req)));
    // Сбросить правки кистью
    if (rest === "mask/edits" && m === "DELETE") return json(await this.serial(() => this.resetMask(id)));
    // Автонастройка яркости и контраста
    if (rest === "auto-tone" && m === "POST") return json(await this.autoTone(id, await this.body(req)));
    // Подготовленное фото с заданным кадром
    if (rest === "prepared.png" && m === "GET") {
      // Кадр из параметров адреса
      const prep = prepIn(Object.fromEntries([...q.entries()].map(([k, v]) => [k, k === "remove_background" || k === "face_focus" ? v === "true" : Number(v)])));
      // PNG
      return bytes(await this.grayPng(await this.prepareGray(await this.image(id), prep)), "image/png", { "Cache-Control": "no-store" });
    }
    // Неизвестный адрес
    throw new HttpError(404, "Не найдено");
  }

  // Сохранить маску, поправленную кистью
  private async putMask(id: string, req: Request) {
    // Фото
    const i = await this.image(id);
    // Байты
    const data = new Uint8Array(await req.arrayBuffer());
    // Пустая или слишком большая
    if (!data.length || data.length > MAX_MASK_BYTES) throw new HttpError(data.length ? 413 : 400, "Маска пустая или слишком большая");
    // Это картинка?
    try {
      // Открываем (проверка)
      (await this.codec.open(data)).close();
      // Не картинка
    } catch {
      // Ошибка
      throw new HttpError(400, "Маска должна быть PNG-картинкой");
    }
    // Сохраняем как поправленную
    await this.store.putImage({ ...i, mask: data, mask_source: "edited" });
    // Состояние
    return maskStatus({ ...i, mask: data, mask_source: "edited" });
  }

  // Вернуть автоматическую маску
  private async resetMask(id: string) {
    // Фото
    const i = await this.image(id);
    // Новая запись
    const row: ImageRow = { ...i, mask: i.mask_auto, mask_source: i.mask_auto ? "auto" : null };
    // Сохраняем
    await this.store.putImage(row);
    // Состояние (без автоматической маски — 503)
    return maskStatus(row);
  }

  // Автонастройка
  private async autoTone(id: string, b: Record<string, unknown>) {
    // Допустимые поля
    onlyFields(b, ["prep", "diameter_cm"]);
    // Фото
    const i = await this.image(id);
    // Кадр
    const base = prepIn(b.prep);
    // Лиц в телефоне нет
    if (base.face_focus) throw new HttpError(422, "В версии для телефона нет «Выделить лицо» — снимите галочку");
    // Диаметр
    const d = numField(b, "diameter_cm", MIN_DIAMETER_CM, MAX_DIAMETER_CM) ?? DEFAULT_DIAMETER_CM;
    // Кадр и маска — один раз
    const { rgba, mask } = await this.frame(i, base);
    // Серое
    const gray = toGray(rgba);
    // Сообщение
    this.progress("Подбираем яркость и контраст…");
    // Перебор
    return autoTone((br, c) => processGray(gray, { ...base, brightness: br, contrast: c }, mask), d);
  }

  // Адреса портрета
  private async projectRoute(m: string, id: string, rest: string, req: Request, q: URLSearchParams): Promise<Response> {
    // Портрет целиком
    if (rest === "" && m === "GET") return json(detail(await this.project(id)));
    // Изменение
    if (rest === "" && m === "PATCH") {
      // Тело
      const b = await this.body(req);
      // По очереди
      return json(await this.serial(() => this.patch(id, b)));
    }
    // Удаление
    if (rest === "" && m === "DELETE") {
      // По очереди
      await this.serial(() => this.remove(id));
      // 204
      return new Response(null, { status: 204 });
    }
    // Учёт времени
    if (rest === "activity" && m === "POST") {
      // Тело
      const b = await this.body(req);
      // По очереди
      return json(await this.serial(() => this.activity(id, b)));
    }
    // Изменить фото
    if (rest === "photo" && m === "PUT") return json(await this.updatePhoto(id, await this.body(req)));
    // Сходство
    if (rest === "similarity" && m === "GET") return json(await this.similarity(id, q));
    // Шаги
    if (rest === "steps" && m === "GET") return json(await this.steps(id, q));
    // Превью
    if (rest === "preview.png" && m === "GET") return bytes(await this.preview(id, q), "image/png", { "Cache-Control": "no-store" });
    // Подготовленное фото
    if (rest === "source.png" && m === "GET") {
      // Портрет есть?
      await this.project(id);
      // Байты
      const src = await this.store.getSource(id);
      // PNG
      return bytes(src ?? new Uint8Array(), "image/png");
    }
    // Файл проекта
    if (rest === "export" && m === "GET") return this.export(id);
    // PDF нет
    if (rest === "instructions.pdf" || rest === "template.pdf") {
      // Портрет есть?
      await this.project(id);
      // Объясняем
      throw new HttpError(404, NO_PDF);
    }
    // Неизвестный адрес
    throw new HttpError(404, "Не найдено");
  }

  // Изменить поля портрета (как PATCH бэкенда)
  private async patch(id: string, b: Record<string, unknown>) {
    // Портрет
    const p = await this.project(id);
    // Допустимые поля
    onlyFields(b, ["name", "diameter_cm", "line_count", "current_step", "speed_sec", "own_spool_m", "layer", "current_layer"]);
    // Изменения
    const row: ProjectRow = { ...p };
    // Название
    if (b.name !== undefined && b.name !== null) {
      // Без пробелов по краям
      const name = String(b.name).trim();
      // Пустое
      if (!name) throw new HttpError(422, "Название не может быть пустым");
      // Слишком длинное
      if (name.length > 100) throw new HttpError(422, "Название — до 100 знаков");
      // Записываем
      row.name = name;
    }
    // Диаметр
    const d = numField(b, "diameter_cm", MIN_DIAMETER_CM, MAX_DIAMETER_CM);
    // Округляем
    if (d !== undefined) row.diameter_cm = Math.round(d * 10) / 10;
    // Скорость
    const s = numField(b, "speed_sec", MIN_SPEED_SEC, MAX_SPEED_SEC);
    // Округляем
    if (s !== undefined) row.speed_sec = Math.round(s * 10) / 10;
    // Своя катушка: явный null — сброс
    if ("own_spool_m" in b) row.own_spool_m = numField(b, "own_spool_m", 10, 100_000) ?? null;
    // Слои
    const layers = layersOf(p).map((l) => ({ ...l }));
    // Номер слоя
    const index = numField(b, "layer", 0, MAX_COLORS - 1, true) ?? 0;
    // Текущая нить
    const current = numField(b, "current_layer", 0, MAX_COLORS - 1, true);
    // Нет такого слоя
    if (index >= layers.length || (current ?? 0) >= layers.length) throw new HttpError(422, `У портрета ${layers.length} сл. — номер слоя от 0 до ${layers.length - 1}`);
    // Текущая нить
    if (current !== undefined) row.current_layer = current;
    // Число линий
    const lines = numField(b, "line_count", LAYER_MIN_LINES, MAX_LINES, true);
    // У одной нити — не меньше 1000
    if (!p.layers.length && lines !== undefined && lines < MIN_LINES) throw new HttpError(422, `Число линий — от ${MIN_LINES} до ${MAX_LINES}`);
    // Шаг
    const step = numField(b, "current_step", 1, MAX_LINES, true);
    // Слой
    const layer = layers[index];
    // Новое число линий
    const lineCount = lines ?? layer.line_count;
    // Шаг дальше конца
    if (step !== undefined && step > lineCount) throw new HttpError(422, `Шаг должен быть в пределах 1..${lineCount}`);
    // Линий стало меньше — не выходим за конец
    layer.line_count = lineCount;
    // Шаг
    layer.current_step = step ?? Math.min(layer.current_step, lineCount);
    // Одна нить — поля самого портрета
    if (!p.layers.length) {
      // Линий
      row.line_count = layer.line_count;
      // Шаг
      row.current_step = layer.current_step;
      // Цветной
    } else {
      // Слои
      row.layers = layers;
      // Первый слой — зеркало в поля портрета
      row.line_count = layers[0].line_count;
      // Шаг первого слоя
      row.current_step = layers[0].current_step;
    }
    // Время изменения
    row.updated_at = nowIso();
    // Сохраняем
    await this.store.putProject(row);
    // Портрет
    return detail(row);
  }

  // Отметка времени плетения
  private async activity(id: string, b: Record<string, unknown>) {
    // Портрет
    const p = await this.project(id);
    // Допустимые поля
    onlyFields(b, ["date", "seconds", "steps"]);
    // Дата
    const date = String(b.date ?? "");
    // Формат ГГГГ-ММ-ДД
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(422, "Дата — ГГГГ-ММ-ДД");
    // Секунды
    const sec = numField(b, "seconds", 0, 600);
    // Шаги
    const steps = numField(b, "steps", 0, 10_000, true);
    // Обязательны
    if (sec === undefined || steps === undefined) throw new HttpError(422, "Нужны seconds и steps");
    // Было за день
    const [s0, n0] = p.activity[date] ?? [0, 0];
    // Прибавляем (время изменения не трогаем — как на бэкенде)
    p.activity = { ...p.activity, [date]: [Math.round((s0 + sec) * 10) / 10, n0 + steps] };
    // Сохраняем
    await this.store.putProject(p);
    // Учёт времени
    return activityOut(p.activity);
  }

  // Удалить портрет и фото, если оно больше нигде не нужно
  private async remove(id: string) {
    // Портрет
    const p = await this.project(id);
    // Удаляем
    await this.store.deleteProject(id);
    // Фото было
    if (p.image_id) {
      // Ещё используется?
      const used = (await this.store.listProjects()).some((x) => x.image_id === p.image_id);
      // Нет — удаляем
      if (!used) await this.store.deleteImage(p.image_id);
    }
  }

  // Изменить фото портрета и пересчитать
  private async updatePhoto(id: string, b: Record<string, unknown>) {
    // Портрет
    const p = await this.project(id);
    // Нет исходного фото
    if (!p.image_id) throw new HttpError(409, "У этого проекта не сохранилось исходное фото");
    // Фото
    const img = await this.image(p.image_id);
    // Кадр (тело — кадр плюс параметры нитей)
    const prep = prepIn(b, ["mode", "colors", "color_count", "board"]);
    // Нити
    const t = this.threadsIn(b);
    // Режим: новый или прежний
    const mode = t.mode ?? (p.mode || "mono");
    // Цвета: новые или прежние (если режим «цветные» не меняется)
    const colors = t.colors ?? (mode === "color" && p.mode === "color" ? p.layers.map((l) => l.color) : null);
    // Доска: новая или прежняя (если режим тот же)
    const board = t.board ?? (mode === p.mode ? p.board : null);
    // Расчёт
    const r = await this.generate(img, prep, mode, colors, t.count ?? DEFAULT_COLORS, board, p.diameter_cm);
    // Изменения записываем по очереди
    return this.serial(async () => {
      // Свежая версия (пока считали, могли поменять название)
      const fresh = await this.project(id);
      // Новая строка: прогресс с начала
      const row: ProjectRow = { ...fresh, sequence: r.sequence, prep: { ...prep }, line_count: r.line_count, current_step: 1, mode: r.mode, board: r.board, layers: r.layers, current_layer: 0, updated_at: nowIso() };
      // Подготовленное фото
      await this.store.putSource(id, r.source_png);
      // Портрет
      await this.store.putProject(row);
      // Ответ
      return detail(row);
    });
  }

  // Шаги плетения страницей
  private async steps(id: string, q: URLSearchParams) {
    // Портрет
    const p = await this.project(id);
    // Сдвиг
    const offset = Math.max(0, Math.floor(Number(q.get("offset") ?? 0)) || 0);
    // Сколько
    const limit = Math.min(1000, Math.max(1, Math.floor(Number(q.get("limit") ?? 100)) || 100));
    // Нить
    const layer = Math.floor(Number(q.get("layer") ?? 0)) || 0;
    // Слои
    const layers = layersOf(p);
    // Нет такой
    if (layer < 0 || layer >= layers.length) throw new HttpError(422, "Нет такого слоя");
    // Схема и число линий
    const { sequence: seq, line_count: total } = layers[layer];
    // Накопленная длина
    const used = cumulativeLengthsM(seq.slice(0, total + 1), p.diameter_cm);
    // Шаги
    const items = [];
    // Каждый шаг страницы
    for (let k = offset; k < Math.min(total, offset + limit); k++) {
      // Шаг
      items.push({ number: k + 1, from_nail: seq[k], to_nail: seq[k + 1], from_label: nailLabel(seq[k]), to_label: nailLabel(seq[k + 1]), thread_used_m: Math.round(used[k + 1] * 100) / 100 });
    }
    // Страница
    return { total, offset, limit, items };
  }

  // Картинка картины
  private async preview(id: string, q: URLSearchParams): Promise<Uint8Array> {
    // Портрет
    const p = await this.project(id);
    // Размер
    const size = Math.min(1600, Math.max(100, Math.floor(Number(q.get("size") ?? 600)) || 600));
    // Число линий первой нити
    const lines = q.get("lines") ? Math.min(MAX_LINES, Math.max(1, Math.floor(Number(q.get("lines"))))) : null;
    // Слои для рисования
    const parts = layersOf(p).map((l, i) => ({ sequence: l.sequence, steps: i === 0 ? (lines ?? l.line_count) : l.line_count, rgb: threadRgb(l.color) }));
    // Пиксели
    const rgba = renderLayers(parts, size, p.diameter_cm, boardRgb(p.layers.length ? p.board : "white"));
    // PNG
    return this.codec.png(rgba, size, size);
  }

  // Кривая сходства
  private async similarity(id: string, q: URLSearchParams) {
    // Портрет
    const p = await this.project(id);
    // Диаметр
    const d = q.get("diameter_cm") ? Number(q.get("diameter_cm")) : p.diameter_cm;
    // Вне пределов
    if (!Number.isFinite(d) || d < MIN_DIAMETER_CM || d > MAX_DIAMETER_CM) throw new HttpError(422, `Диаметр — от ${MIN_DIAMETER_CM} до ${MAX_DIAMETER_CM} см`);
    // Нить
    const layer = Math.floor(Number(q.get("layer") ?? 0)) || 0;
    // Нет такой
    if (layer < 0 || layer >= MAX_COLORS || (p.layers.length && layer >= p.layers.length)) throw new HttpError(422, "Нет такого слоя");
    // Ключ кэша: схема, число линий других нитей, диаметр, нить
    const key = [p.id, hashOf(p.sequence), ...p.layers.map((l, i) => (i === layer ? 0 : l.line_count)), Math.round(d * 10), layer].join(":");
    // Уже считали
    const ready = this.curves.get(key);
    // Отдаём
    if (ready) return ready;
    // Подготовленное фото
    const src = await this.store.getSource(id);
    // Нет фото
    if (!src) throw new HttpError(409, "У портрета нет подготовленного фото");
    // Открываем
    const bmp = await this.codec.open(src);
    // Пиксели 400×400
    const rgba = bmp.crop(0, 0, bmp.width, PROCESSING_SIZE);
    // Освобождаем
    bmp.close();
    // Кривая
    let curve: [number, number][];
    // Цветной портрет
    if (p.layers.length) {
      // Цвета точек в долях
      const target = new Float32Array(PROCESSING_SIZE * PROCESSING_SIZE * 3);
      // Каждая точка
      for (let i = 0; i < target.length / 3; i++) for (let c = 0; c < 3; c++) target[i * 3 + c] = rgba[i * 4 + c] / 255;
      // Кривая нити
      curve = layerCurve(target, p.board || "white", p.layers, layer, d);
      // Одна нить
    } else {
      // Кривая по яркости
      curve = similarityCurve(p.sequence, toGray(rgba), d);
    }
    // Лучшая точка
    const [bestN, bestS] = bestPoint(curve);
    // Ответ
    const result = { diameter_cm: Math.round(d * 10) / 10, best_lines: bestN, best_score: bestS, curve: curve.map(([lines, score]) => ({ lines, score })) };
    // Кэш не растёт бесконечно
    if (this.curves.size > 32) this.curves.clear();
    // Запоминаем
    this.curves.set(key, result);
    // Ответ
    return result;
  }

  // Файл проекта
  private async export(id: string): Promise<Response> {
    // Портрет
    const p = await this.project(id);
    // Подготовленное фото
    const src = (await this.store.getSource(id)) ?? new Uint8Array();
    // Фото
    const img = p.image_id ? await this.store.getImage(p.image_id) : null;
    // Содержимое — как у бэкенда
    const data = {
      // Формат
      format: FORMAT,
      // Версия
      version: VERSION,
      // Когда
      exported_at: nowIso(),
      // Откуда
      app: LOCAL_VERSION,
      // Портрет
      project: {
        // Название
        name: p.name,
        // Диаметр
        diameter_cm: p.diameter_cm,
        // Линий
        line_count: p.line_count,
        // Шаг
        current_step: p.current_step,
        // Скорость
        speed_sec: p.speed_sec,
        // Кадр
        prep: p.prep,
        // Катушка
        own_spool_m: p.own_spool_m,
        // Схема
        sequence: p.sequence,
        // Учёт времени
        activity: p.activity,
        // Режим
        mode: p.mode || "mono",
        // Доска
        board: p.board || "white",
        // Текущая нить
        current_layer: p.current_layer || 0,
        // Нити
        layers: p.layers,
      },
      // Подготовленное фото
      source_png: toB64(src),
      // Исходное фото
      image: img
        // Есть
        ? { width: img.width, height: img.height, faces: img.faces, original_jpeg: toB64(img.original), mask_png: img.mask ? toB64(img.mask) : null, mask_source: img.mask ? img.mask_source : null }
        // Нет
        : null,
    };
    // Имя файла латиницей
    const ascii = `nitegraf-${p.id}${EXTENSION}`;
    // Имя по-русски
    const utf = encodeURIComponent(`${p.name}${EXTENSION}`);
    // Вложение JSON
    return bytes(new TextEncoder().encode(JSON.stringify(data)), "application/json", { "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${utf}` });
  }

  // Открыть файл проекта
  private async importFile(req: Request) {
    // Файл
    const { bytes: raw } = await this.file(req, Infinity, "");
    // Разбор и проверка
    const data = parseTransfer(raw);
    // Подготовленное фото
    const source = fromB64(data.source_png, "Подготовленное фото");
    // Это картинка?
    try {
      // Открываем
      (await this.codec.open(source)).close();
      // Нет
    } catch {
      // Ошибка
      throw new HttpError(422, "Подготовленное фото испорчено");
    }
    // Фото
    let imageId: string | null = null;
    // Есть исходное фото
    if (data.image) {
      // Байты
      const original = fromB64(data.image.original_jpeg, "Исходное фото");
      // Это картинка?
      try {
        // Открываем
        (await this.codec.open(original)).close();
        // Нет
      } catch {
        // Ошибка
        throw new HttpError(422, "Исходное фото испорчено");
      }
      // Маска
      const mask = data.image.mask_png ? fromB64(data.image.mask_png, "Маска фона") : null;
      // Поправлена ли кистью
      const edited = data.image.mask_source === "edited";
      // Новое фото
      imageId = newId();
      // Сохраняем
      await this.store.putImage({ id: imageId, created_at: nowIso(), width: data.image.width, height: data.image.height, faces: data.image.faces, original, mask, mask_auto: mask && !edited ? mask : null, mask_source: mask ? (edited ? "edited" : "auto") : null });
    }
    // Портрет из файла
    const p = data.project;
    // Сохраняем
    const row = await this.saveNew(
      {
        // Название
        name: p.name.trim() || "Портрет",
        // Диаметр
        diameter_cm: Math.round(p.diameter_cm * 10) / 10,
        // Линий
        line_count: p.line_count,
        // Скорость
        speed_sec: Math.round(p.speed_sec * 10) / 10,
        // Схема
        sequence: p.sequence,
        // Фото
        image_id: imageId,
        // Кадр
        prep: p.prep,
        // Режим
        mode: p.mode,
        // Доска
        board: p.board,
        // Нити
        layers: p.layers,
        // Шаг
        current_step: p.current_step,
        // Текущая нить
        current_layer: p.current_layer,
        // Катушка
        own_spool_m: p.own_spool_m,
        // Учёт времени
        activity: p.activity,
      },
      // Подготовленное фото
      source,
    );
    // Портрет
    return detail(row);
  }
}
