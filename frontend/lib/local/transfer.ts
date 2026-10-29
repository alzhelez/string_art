// Версия для телефона: файл проекта «.nitegraf» — тот же формат, что backend/app/transfer.py.
// Проверки и тексты ошибок такие же: файл с компьютера открывается в телефоне и наоборот.

// Ограничения из настроек
import { MAX_DIAMETER_CM, MAX_LINES, MAX_SPEED_SEC, MIN_DIAMETER_CM, MIN_LINES, MIN_SPEED_SEC, DEFAULT_SPEED_SEC, TOTAL_NAILS } from "../constants";
// Справочники нитей и досок, число цветов
import { BOARD_BY_KEY, MAX_COLORS, MODES, THREAD_BY_KEY } from "./colors";

// Метка формата
export const FORMAT = "nitegraf";
// Версия формата
export const VERSION = 1;
// Расширение файла
export const EXTENSION = ".nitegraf";
// Самый большой файл
export const MAX_FILE_BYTES = 40 * 1024 * 1024;

/** Ошибка открытия файла: код ответа и текст для человека. */
export class TransferError extends Error {
  // Код HTTP
  status: number;
  // Создание
  constructor(status: number, message: string) {
    // Текст
    super(message);
    // Код
    this.status = status;
  }
}

// Ошибка проверки поля: текст и путь к полю
class FieldError extends Error {
  // Путь к полю (project.sequence)
  loc: string;
  // Создание
  constructor(message: string, loc: string) {
    // Текст
    super(message);
    // Путь
    this.loc = loc;
  }
}

/** Байты → base64. */
export function toB64(bytes: Uint8Array): string {
  // Строка из кусков по 32 КБ (иначе переполнится стек)
  let s = "";
  // Каждый кусок
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  // base64
  return btoa(s);
}

/** base64 → байты; испорченные данные — ошибка с названием. */
export function fromB64(text: string, what: string): Uint8Array {
  // Строгая проверка алфавита и длины (как base64.b64decode(validate=True))
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) throw new TransferError(422, `${what}: испорченные данные`);
  // Расшифровка
  const s = atob(text);
  // Байты
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

// Объект ли это (не массив, не null)
function isObj(v: unknown): v is Record<string, unknown> {
  // Проверка
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Лишние поля запрещены
function noExtra(o: Record<string, unknown>, allowed: string[], loc: string): void {
  // Каждое поле
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new FieldError("Extra inputs are not permitted", loc ? `${loc}.${k}` : k);
}

// Целое число в пределах
function int(v: unknown, lo: number, hi: number, loc: string): number {
  // Не целое
  if (typeof v !== "number" || !Number.isInteger(v)) throw new FieldError("Input should be a valid integer", loc);
  // Вне пределов
  if (v < lo || v > hi) throw new FieldError(`Input should be between ${lo} and ${hi}`, loc);
  // Число
  return v;
}

// Число в пределах
function num(v: unknown, lo: number, hi: number, loc: string): number {
  // Не число
  if (typeof v !== "number" || !Number.isFinite(v)) throw new FieldError("Input should be a valid number", loc);
  // Вне пределов
  if (v < lo || v > hi) throw new FieldError(`Input should be between ${lo} and ${hi}`, loc);
  // Число
  return v;
}

// Строка
function str(v: unknown, loc: string): string {
  // Не строка
  if (typeof v !== "string") throw new FieldError("Input should be a valid string", loc);
  // Строка
  return v;
}

// Схема: от 1 до 5000 линий, гвозди 0…239
function sequence(v: unknown, loc: string): number[] {
  // Не список
  if (!Array.isArray(v)) throw new FieldError("Input should be a valid list", loc);
  // Каждый — целое
  v.forEach((n, i) => int(n, -Infinity, Infinity, `${loc}.${i}`));
  // Длина
  if (v.length < 2 || v.length > MAX_LINES + 1) throw new FieldError("Схема должна содержать от 1 до 5000 линий", loc);
  // Номера гвоздей
  if (v.some((n: number) => n < 0 || n >= TOTAL_NAILS)) throw new FieldError("Номер гвоздя вне 0…239", loc);
  // Схема
  return v as number[];
}

/** Нить в файле. */
export interface LayerFile {
  // Ключ нити
  color: string;
  // Схема
  sequence: number[];
  // Сколько линий
  line_count: number;
  // Текущий шаг
  current_step: number;
}

/** Портрет в файле. */
export interface ProjectFile {
  // Название
  name: string;
  // Диаметр
  diameter_cm: number;
  // Линий
  line_count: number;
  // Текущий шаг
  current_step: number;
  // Скорость
  speed_sec: number;
  // Кадр
  prep: Record<string, unknown>;
  // Своя катушка
  own_spool_m: number | null;
  // Учёт времени
  activity: Record<string, [number, number]>;
  // Режим
  mode: string;
  // Доска
  board: string;
  // Текущая нить
  current_layer: number;
  // Схема
  sequence: number[];
  // Нити
  layers: LayerFile[];
}

/** Фото в файле. */
export interface ImageFile {
  // Ширина
  width: number;
  // Высота
  height: number;
  // Лица
  faces: { x: number; y: number; w: number; h: number }[];
  // Оригинал (base64)
  original_jpeg: string;
  // Маска (base64) или null
  mask_png: string | null;
  // Откуда маска
  mask_source: "auto" | "edited" | null;
}

/** Весь файл. */
export interface TransferFile {
  // Метка формата
  format: "nitegraf";
  // Версия
  version: number;
  // Когда сохранён
  exported_at: string | null;
  // Версия программы
  app: string | null;
  // Портрет
  project: ProjectFile;
  // Подготовленное фото (base64)
  source_png: string;
  // Исходное фото
  image: ImageFile | null;
}

// Проверить нить
function layerFile(v: unknown, loc: string): LayerFile {
  // Не объект
  if (!isObj(v)) throw new FieldError("Input should be a valid dictionary", loc);
  // Лишние поля
  noExtra(v, ["color", "sequence", "line_count", "current_step"], loc);
  // Цвет
  const color = str(v.color, `${loc}.color`);
  // Известен ли
  if (!THREAD_BY_KEY.has(color)) throw new FieldError(`Неизвестный цвет нити: ${color}`, `${loc}.color`);
  // Схема
  const seq = sequence(v.sequence, `${loc}.sequence`);
  // Линий
  const lineCount = int(v.line_count, 1, MAX_LINES, `${loc}.line_count`);
  // Шаг
  const step = v.current_step === undefined ? 1 : int(v.current_step, 1, MAX_LINES, `${loc}.current_step`);
  // Линий больше, чем в схеме
  if (lineCount > seq.length - 1) throw new FieldError("Линий больше, чем в схеме", loc);
  // Шаг не дальше конца
  return { color, sequence: seq, line_count: lineCount, current_step: Math.min(step, lineCount) };
}

// Проверить портрет
function projectFile(v: unknown): ProjectFile {
  // Путь
  const loc = "project";
  // Не объект
  if (!isObj(v)) throw new FieldError("Input should be a valid dictionary", loc);
  // Лишние поля
  noExtra(v, ["name", "diameter_cm", "line_count", "current_step", "speed_sec", "prep", "own_spool_m", "activity", "mode", "board", "current_layer", "sequence", "layers"], loc);
  // Название
  const name = str(v.name, `${loc}.name`);
  // Длина названия
  if (name.length < 1 || name.length > 100) throw new FieldError("String should have between 1 and 100 characters", `${loc}.name`);
  // Режим
  const mode = v.mode === undefined ? "mono" : str(v.mode, `${loc}.mode`);
  // Известен ли
  if (!(MODES as readonly string[]).includes(mode)) throw new FieldError("Input should be 'mono', 'bw' or 'color'", `${loc}.mode`);
  // Доска
  const board = v.board === undefined ? "white" : str(v.board, `${loc}.board`);
  // Известна ли
  if (!BOARD_BY_KEY.has(board)) throw new FieldError(`Неизвестный цвет доски: ${board}`, `${loc}.board`);
  // Учёт времени
  const activity = v.activity === undefined ? {} : v.activity;
  // Не объект
  if (!isObj(activity)) throw new FieldError("Input should be a valid dictionary", `${loc}.activity`);
  // Каждый день
  for (const [day, pair] of Object.entries(activity)) {
    // Дата ГГГГ-ММ-ДД и пара неотрицательных чисел
    const ok = day.length === 10 && day[4] === "-" && day[7] === "-" && Array.isArray(pair) && pair.length === 2 && pair.every((x) => typeof x === "number" && x >= 0);
    // Испорчен
    if (!ok) throw new FieldError("Учёт времени испорчен", `${loc}.activity`);
  }
  // Кадр
  const prep = v.prep === undefined ? {} : v.prep;
  // Не объект
  if (!isObj(prep)) throw new FieldError("Input should be a valid dictionary", `${loc}.prep`);
  // Нити
  const rawLayers = v.layers === undefined ? [] : v.layers;
  // Не список
  if (!Array.isArray(rawLayers)) throw new FieldError("Input should be a valid list", `${loc}.layers`);
  // Не больше четырёх
  if (rawLayers.length > MAX_COLORS) throw new FieldError(`List should have at most ${MAX_COLORS} items`, `${loc}.layers`);
  // Каждая нить
  const layers = rawLayers.map((l, i) => layerFile(l, `${loc}.layers.${i}`));
  // Схема
  const seq = sequence(v.sequence, `${loc}.sequence`);
  // Линий
  const lineCount = int(v.line_count, 1, MAX_LINES, `${loc}.line_count`);
  // Шаг
  const step = v.current_step === undefined ? 1 : int(v.current_step, 1, MAX_LINES, `${loc}.current_step`);
  // Скорость
  const speed = v.speed_sec === undefined ? DEFAULT_SPEED_SEC : num(v.speed_sec, MIN_SPEED_SEC, MAX_SPEED_SEC, `${loc}.speed_sec`);
  // Своя катушка
  const spool = v.own_spool_m === undefined || v.own_spool_m === null ? null : num(v.own_spool_m, 10, 100_000, `${loc}.own_spool_m`);
  // Текущая нить
  let currentLayer = v.current_layer === undefined ? 0 : int(v.current_layer, 0, MAX_COLORS - 1, `${loc}.current_layer`);
  // Диаметр
  const diameter = num(v.diameter_cm, MIN_DIAMETER_CM, MAX_DIAMETER_CM, `${loc}.diameter_cm`);
  // Режим и нити согласованы
  if ((mode === "mono") !== (layers.length === 0)) throw new FieldError("Режим не совпадает с числом нитей", loc);
  // Цветной — хотя бы две нити
  if (layers.length && layers.length < 2) throw new FieldError("Цветной портрет должен содержать хотя бы две нити", loc);
  // Первая нить совпадает со схемой
  if (layers.length && layers[0].sequence.join() !== seq.join()) throw new FieldError("Первая нить не совпадает со схемой", loc);
  // Нет такой нити — первая
  if (currentLayer >= Math.max(1, layers.length)) currentLayer = 0;
  // Линий больше, чем в схеме
  if (lineCount > seq.length - 1) throw new FieldError("Линий больше, чем в схеме", loc);
  // У одной нити — не меньше 1000 линий
  if (!layers.length && lineCount < MIN_LINES) throw new FieldError(`Число линий — от ${MIN_LINES}`, loc);
  // Портрет
  return {
    // Название
    name,
    // Диаметр
    diameter_cm: diameter,
    // Линий
    line_count: lineCount,
    // Шаг не дальше конца
    current_step: Math.min(step, lineCount),
    // Скорость
    speed_sec: speed,
    // Кадр
    prep,
    // Катушка
    own_spool_m: spool,
    // Учёт времени
    activity: activity as Record<string, [number, number]>,
    // Режим
    mode,
    // Доска
    board,
    // Текущая нить
    current_layer: currentLayer,
    // Схема
    sequence: seq,
    // Нити
    layers,
  };
}

// Проверить фото
function imageFile(v: unknown): ImageFile | null {
  // Нет фото
  if (v === null || v === undefined) return null;
  // Путь
  const loc = "image";
  // Не объект
  if (!isObj(v)) throw new FieldError("Input should be a valid dictionary", loc);
  // Лишние поля
  noExtra(v, ["width", "height", "faces", "original_jpeg", "mask_png", "mask_source"], loc);
  // Лица
  const faces = v.faces === undefined ? [] : v.faces;
  // Список не длиннее 20
  if (!Array.isArray(faces) || faces.length > 20) throw new FieldError("Input should be a valid list", `${loc}.faces`);
  // Каждое лицо — числа
  faces.forEach((f, i) => {
    // Объект с числами
    if (!isObj(f) || Object.values(f).some((x) => typeof x !== "number")) throw new FieldError("Input should be a valid dictionary", `${loc}.faces.${i}`);
  });
  // Откуда маска
  const source = v.mask_source ?? null;
  // Только auto, edited или null
  if (source !== null && source !== "auto" && source !== "edited") throw new FieldError("Input should be 'auto' or 'edited'", `${loc}.mask_source`);
  // Фото
  return {
    // Ширина
    width: int(v.width, 1, 10_000, `${loc}.width`),
    // Высота
    height: int(v.height, 1, 10_000, `${loc}.height`),
    // Лица
    faces: faces as ImageFile["faces"],
    // Оригинал
    original_jpeg: str(v.original_jpeg, `${loc}.original_jpeg`),
    // Маска
    mask_png: v.mask_png === undefined || v.mask_png === null ? null : str(v.mask_png, `${loc}.mask_png`),
    // Источник маски
    mask_source: source,
  };
}

/** Разобрать файл: не JSON или чужой формат → 400, испорченный → 422 с понятным текстом. */
export function parseTransfer(raw: Uint8Array): TransferFile {
  // Слишком большой
  if (raw.length > MAX_FILE_BYTES) throw new TransferError(413, "Файл слишком большой (максимум 40 МБ)");
  // Содержимое
  let body: unknown;
  // Может быть не текст и не JSON
  try {
    // UTF-8 строго (fatal — ошибка на неверных байтах)
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    // Не JSON
  } catch {
    // Чужой файл
    throw new TransferError(400, "Это не файл проекта «Нитеграфа»");
  }
  // Не объект или другой формат
  if (!isObj(body) || body.format !== FORMAT) throw new TransferError(400, "Это не файл проекта «Нитеграфа»");
  // Проверка полей
  try {
    // Лишние поля верхнего уровня
    noExtra(body, ["format", "version", "exported_at", "app", "project", "source_png", "image"], "");
    // Версия
    const version = int(body.version, 1, Infinity, "version");
    // Новее нашей
    if (version > VERSION) throw new FieldError("Файл сохранён новой версией программы — обновите «Нитеграф»", "version");
    // Весь файл
    return {
      // Формат
      format: FORMAT,
      // Версия
      version,
      // Когда сохранён
      exported_at: body.exported_at == null ? null : str(body.exported_at, "exported_at"),
      // Версия программы
      app: body.app == null ? null : str(body.app, "app"),
      // Портрет
      project: projectFile(body.project),
      // Подготовленное фото
      source_png: str(body.source_png, "source_png"),
      // Исходное фото
      image: imageFile(body.image),
    };
    // Ошибка поля
  } catch (e) {
    // Текст и путь, как у бэкенда
    if (e instanceof FieldError) throw new TransferError(422, `Файл проекта испорчен: ${e.message} (${e.loc})`);
    // Другая ошибка — дальше
    throw e;
  }
}
