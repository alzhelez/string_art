// Версия для телефона: цветные портреты (как backend/app/palette.py и layers.py).
// Для каждой точки ищем, сколько каждой нити нужно (aₖ ≥ 0, Σaₖ ≤ 1), чтобы цвет
// «доска · (1 − Σaₖ) + Σ aₖ · нитьₖ» был ближе всего к фото. Карта aₖ — карта темноты
// для обычного алгоритма: каждая нить плетётся отдельным слоем. Сколько линий взять
// в каждом слое, подбирается по картине целиком (детали яркости + цвет).

// Расчёт схемы, карта цели, маска круга, счётчики нитей
import { buildLineCache, circleMask, generateSequence, lineCounts, MAX_LINES, PROCESSING_SIZE, rint, targetMap, addLine } from "./algorithm";
// Размытие
import { gaussianBlur } from "./blur";
// Оценщик деталей, пропускание света, непрозрачность линии
import { half, keepTable, lineAlpha, Scorer } from "./similarity";

// Режимы: одна чёрная нить, чёрная + белая, цветные
export const MODES = ["mono", "bw", "color"] as const;
// Тип режима
export type Mode = (typeof MODES)[number];
// Меньше всего цветных нитей
export const MIN_COLORS = 2;
// Больше всего
export const MAX_COLORS = 4;
// Меньше всего линий в слое
export const LAYER_MIN_LINES = 100;
// Цветов по умолчанию при автоподборе
export const DEFAULT_COLORS = 3;
// Шаг сетки числа линий при подборе
export const GRID = 100;
// Вес цвета в оценке
export const COLOR_WEIGHT = 10;
// Размытие для сравнения цвета, мм
export const COLOR_BLUR_MM = 3;

/** Нить или цвет доски. */
export interface Swatch {
  // Ключ
  key: string;
  // Название
  name: string;
  // Цвет #rrggbb
  hex: string;
}

// Нити в продаже (как THREADS на бэкенде)
export const THREADS: Swatch[] = [
  // Чёрная
  { key: "black", name: "Чёрная", hex: "#1b1b1b" },
  // Белая
  { key: "white", name: "Белая", hex: "#f5f5f0" },
  // Серая
  { key: "gray", name: "Серая", hex: "#7a7a7a" },
  // Красная
  { key: "red", name: "Красная", hex: "#c0262d" },
  // Бежевая
  { key: "beige", name: "Бежевая", hex: "#d9b48f" },
  // Коричневая
  { key: "brown", name: "Коричневая", hex: "#6b4226" },
  // Оранжевая
  { key: "orange", name: "Оранжевая", hex: "#e3742a" },
  // Жёлтая
  { key: "yellow", name: "Жёлтая", hex: "#f0c419" },
  // Синяя
  { key: "blue", name: "Синяя", hex: "#2457a6" },
  // Тёмно-синяя
  { key: "navy", name: "Тёмно-синяя", hex: "#1f2b4d" },
  // Зелёная
  { key: "green", name: "Зелёная", hex: "#2f7d3a" },
  // Розовая
  { key: "pink", name: "Розовая", hex: "#e48aa8" },
  // Фиолетовая
  { key: "purple", name: "Фиолетовая", hex: "#6a3d8f" },
];

// Цвета доски
export const BOARDS: Swatch[] = [
  // Белая
  { key: "white", name: "Белая", hex: "#ffffff" },
  // Серая
  { key: "gray", name: "Серая", hex: "#9a9a9a" },
  // Графитовая
  { key: "graphite", name: "Графитовая", hex: "#5c5c5c" },
  // Бежевая
  { key: "beige", name: "Бежевая", hex: "#d6c4a3" },
  // Тёмно-синяя
  { key: "navy", name: "Тёмно-синяя", hex: "#2b3a55" },
];

// Нить по ключу
export const THREAD_BY_KEY = new Map(THREADS.map((t) => [t.key, t]));
// Доска по ключу
export const BOARD_BY_KEY = new Map(BOARDS.map((b) => [b.key, b]));
// Доска по умолчанию для режима
export const DEFAULT_BOARD: Record<Mode, string> = { mono: "white", bw: "gray", color: "white" };

// Цвет тройкой
export type RGB = [number, number, number];

/** «#1b1b1b» → [0,106, 0,106, 0,106] (доли 0..1). */
export function hexToRgb(hex: string): RGB {
  // Без решётки
  const h = hex.replace("#", "");
  // Три пары цифр
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
}

// Яркость цвета
export function luminance(rgb: RGB): number {
  // Как в Python
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

// Цвет нити по ключу
export function threadRgb(key: string): RGB {
  // Нить
  const t = THREAD_BY_KEY.get(key);
  // Неизвестная — ошибка
  if (!t) throw new Error(`Неизвестный цвет нити: ${key}`);
  // Цвет
  return hexToRgb(t.hex);
}

// Цвет доски по ключу (неизвестная — белая)
export function boardRgb(key: string | null | undefined): RGB {
  // Доска
  return hexToRgb((BOARD_BY_KEY.get(key ?? "white") ?? BOARDS[0]).hex);
}

/** Порядок плетения по умолчанию: от светлых нитей к тёмным. */
export function weaveOrder(keys: string[]): string[] {
  // Сортировка по убыванию яркости (устойчивая — как sorted в Python)
  return [...keys].sort((a, b) => luminance(threadRgb(b)) - luminance(threadRgb(a)));
}

// Буфер сортировки для проекции (нитей не больше четырёх)
const sorted = new Float64Array(MAX_COLORS);

// Проекция вектора a (длина k) на {a ≥ 0, Σa ≤ 1}
function project(a: Float64Array, k: number): void {
  // Сумма положительной части
  let sum = 0;
  // Отрицательное — в ноль
  for (let i = 0; i < k; i++) {
    // Не меньше нуля
    if (a[i] < 0) a[i] = 0;
    // Сумма
    sum += a[i];
  }
  // Влезает — готово
  if (sum <= 1) return;
  // Сортировка вставками по убыванию (без выделения памяти)
  for (let i = 0; i < k; i++) {
    // Очередное значение
    const v = a[i];
    // Позиция вставки
    let j = i;
    // Сдвигаем меньшие вправо
    while (j > 0 && sorted[j - 1] < v) {
      // Сдвиг
      sorted[j] = sorted[j - 1];
      // Левее
      j--;
    }
    // Вставка
    sorted[j] = v;
  }
  // Накопленная сумма
  let css = 0;
  // Порог
  let theta = 0;
  // Ищем, сколько координат останутся положительными
  for (let i = 0; i < k; i++) {
    // Накопили
    css += sorted[i];
    // Условие: координата больше среднего «излишка»
    if (sorted[i] - (css - 1) / (i + 1) > 0) theta = (css - 1) / (i + 1);
  }
  // Сдвигаем и обрезаем снизу
  for (let i = 0; i < k; i++) a[i] = Math.max(a[i] - theta, 0);
}

// Наибольшее собственное число симметричной матрицы k×k (степенной метод)
function maxEigen(m: number[][]): number {
  // Размер
  const k = m.length;
  // Начальный вектор
  let v = Array(k).fill(1 / Math.sqrt(k));
  // Оценка
  let lambda = 0;
  // 100 шагов хватает с запасом для k ≤ 4
  for (let it = 0; it < 100; it++) {
    // m · v
    const w = m.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
    // Длина
    const norm = Math.hypot(...w);
    // Нулевая матрица
    if (norm === 0) return 0;
    // Оценка собственного числа
    lambda = norm;
    // Нормируем
    v = w.map((x) => x / norm);
  }
  // Число
  return lambda;
}

/**
 * Сколько каждой нити нужно в каждой точке: массив k карт (по точкам).
 * target — цвета точек подряд (r, g, b, r, g, b…) в долях 0..1.
 */
export function coverage(target: Float32Array, board: RGB, threads: RGB[], iters = 200): Float32Array[] {
  // Число нитей
  const k = threads.length;
  // Число точек
  const n = target.length / 3;
  // Направления «от доски к нити»
  const d = threads.map((t) => [t[0] - board[0], t[1] - board[1], t[2] - board[2]]);
  // Матрица dᵀd
  const dtd = d.map((a) => d.map((b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  // Шаг градиента
  const step = 1 / Math.max(maxEigen(dtd), 1e-6);
  // Результат: k карт
  const out = threads.map(() => new Float32Array(n));
  // dᵀd одной строкой — быстрее во внутреннем цикле
  const m = Float64Array.from(dtd.flat());
  // Рабочие векторы
  const a = new Float64Array(MAX_COLORS);
  // dᵀy для точки
  const dty = new Float64Array(k);
  // Градиент
  const g = new Float64Array(k);
  // Уже посчитанные цвета (с точностью до байта): цвет → номер точки с ответом
  const memo = new Map<number, number>();
  // Каждая точка
  for (let p = 0; p < n; p++) {
    // Цвет точки, округлённый до байта (на карты в 256 оттенков это не влияет)
    const r8 = Math.round(Math.min(1, Math.max(0, target[p * 3])) * 255);
    // Зелёный
    const g8 = Math.round(Math.min(1, Math.max(0, target[p * 3 + 1])) * 255);
    // Синий
    const b8 = Math.round(Math.min(1, Math.max(0, target[p * 3 + 2])) * 255);
    // Ключ цвета
    const key = (r8 << 16) | (g8 << 8) | b8;
    // Такой цвет уже был
    const seen = memo.get(key);
    // Копируем ответ
    if (seen !== undefined) {
      // Каждая нить
      for (let i = 0; i < k; i++) out[i][p] = out[i][seen];
      // Дальше
      continue;
    }
    // Запоминаем точку
    memo.set(key, p);
    // Цвет минус доска
    const y0 = r8 / 255 - board[0];
    // Зелёный
    const y1 = g8 / 255 - board[1];
    // Синий
    const y2 = b8 / 255 - board[2];
    // dᵀy
    for (let i = 0; i < k; i++) dty[i] = d[i][0] * y0 + d[i][1] * y1 + d[i][2] * y2;
    // С нуля
    a.fill(0);
    // Проекция градиента
    for (let it = 0; it < iters; it++) {
      // Насколько сдвинулись за шаг
      let moved = 0;
      // Градиент: a·dᵀd − dᵀy
      for (let i = 0; i < k; i++) {
        // Минус dᵀy
        let v = -dty[i];
        // Плюс строка матрицы на a
        for (let j = 0; j < k; j++) v += m[i * k + j] * a[j];
        // Записываем
        g[i] = v;
      }
      // Шаг против градиента (запоминаем старое значение для проверки сходимости)
      for (let i = 0; i < k; i++) {
        // Сохраняем в градиент старое значение
        const old = a[i];
        // Шаг
        a[i] -= step * g[i];
        // Старое — в g (градиент больше не нужен)
        g[i] = old;
      }
      // Обратно в допустимую область
      project(a, k);
      // Насколько изменились
      for (let i = 0; i < k; i++) moved = Math.max(moved, Math.abs(a[i] - g[i]));
      // Сошлось — дальше не меняется заметно
      if (moved < 1e-7) break;
    }
    // Записываем
    for (let i = 0; i < k; i++) out[i][p] = a[i];
  }
  // Карты
  return out;
}

// Ошибка восстановления цвета набором нитей (для автоподбора)
function paletteError(target: Float32Array, board: RGB, threads: RGB[]): number {
  // Сколько каждой нити
  const cov = coverage(target, board, threads, 80);
  // Сумма квадратов
  let sum = 0;
  // Каждая точка
  for (let p = 0; p < target.length / 3; p++) {
    // Каждый канал
    for (let c = 0; c < 3; c++) {
      // Восстановленный цвет
      let v = board[c];
      // Вклад нитей
      threads.forEach((t, i) => (v += cov[i][p] * (t[c] - board[c])));
      // Квадрат ошибки
      sum += (v - target[p * 3 + c]) ** 2;
    }
  }
  // Средняя
  return sum / target.length;
}

/** Уменьшить цветную картинку size×size до out×out усреднением (как BOX в PIL). */
export function shrink(target: Float32Array, size: number, out = 64): Float32Array {
  // Результат
  const res = new Float32Array(out * out * 3);
  // Сколько точек в клетке
  const cnt = new Float32Array(out * out);
  // Каждая точка
  for (let y = 0; y < size; y++) {
    // Строка клетки
    const cy = Math.min(out - 1, Math.floor((y * out) / size));
    // Каждый столбец
    for (let x = 0; x < size; x++) {
      // Номер клетки
      const cell = cy * out + Math.min(out - 1, Math.floor((x * out) / size));
      // Каждый канал (как в Python: сначала в байт с отбрасыванием дроби)
      for (let c = 0; c < 3; c++) res[cell * 3 + c] += Math.floor(Math.min(1, Math.max(0, target[(y * size + x) * 3 + c])) * 255);
      // Счёт
      cnt[cell]++;
    }
  }
  // Среднее и обратно в доли
  for (let i = 0; i < out * out; i++) for (let c = 0; c < 3; c++) res[i * 3 + c] = Math.round(res[i * 3 + c] / cnt[i]) / 255;
  // Маленькая картинка
  return res;
}

/** Автоподбор цветов: жадно от чёрной, белую не берём. */
export function choosePalette(target: Float32Array, size: number, board: RGB, count: number, required = ["black"]): string[] {
  // Маленькая копия 64×64 — подбор быстрый
  const small = shrink(target, size);
  // Обязательные
  const chosen = [...required];
  // Кандидаты
  const candidates = THREADS.map((t) => t.key).filter((k) => !chosen.includes(k) && k !== "white");
  // Пока не набрали
  while (chosen.length < count && candidates.length) {
    // Лучший кандидат
    let best = candidates[0];
    // Его ошибка
    let bestErr = Infinity;
    // Каждый кандидат
    for (const c of candidates) {
      // Ошибка набора с ним
      const err = paletteError(small, board, [...chosen, c].map(threadRgb));
      // Меньше — лучше (при равенстве — раньше по ключу, как min в Python)
      if (err < bestErr || (err === bestErr && c < best)) {
        // Запоминаем
        bestErr = err;
        // Кандидат
        best = c;
      }
    }
    // Берём
    chosen.push(best);
    // Убираем из кандидатов
    candidates.splice(candidates.indexOf(best), 1);
  }
  // В порядке плетения
  return weaveOrder(chosen);
}

/** Какие нити и какая доска: режим, ручной выбор или автоподбор. */
export function resolvePalette(
  // Режим
  mode: string,
  // Ручной выбор нитей
  colors: string[] | null | undefined,
  // Доска
  board: string | null | undefined,
  // Фото (для автоподбора)
  target: Float32Array | null,
  // Сторона фото
  size: number,
  // Сколько цветов подобрать
  count: number,
// Возвращает ключи нитей и доску
): { keys: string[]; board: string } {
  // Режим известен?
  if (!(MODES as readonly string[]).includes(mode)) throw new Error(`Неизвестный режим: ${mode}`);
  // Доска
  const boardKey = board || DEFAULT_BOARD[mode as Mode];
  // Доска известна?
  if (!BOARD_BY_KEY.has(boardKey)) throw new Error(`Неизвестный цвет доски: ${boardKey}`);
  // Одна нить
  if (mode === "mono") return { keys: ["black"], board: boardKey };
  // Чёрная и белая
  if (mode === "bw") return { keys: ["white", "black"], board: boardKey };
  // Ручной выбор
  if (colors && colors.length) {
    // Без повторов
    const keys = [...new Set(colors)];
    // Неизвестные
    const unknown = keys.filter((k) => !THREAD_BY_KEY.has(k));
    // Есть неизвестные — ошибка
    if (unknown.length) throw new Error(`Неизвестные цвета нити: ${unknown.join(", ")}`);
    // Число цветов
    if (keys.length < MIN_COLORS || keys.length > MAX_COLORS) throw new Error(`Выберите от ${MIN_COLORS} до ${MAX_COLORS} цветов`);
    // В порядке плетения
    return { keys: weaveOrder(keys), board: boardKey };
  }
  // Автоподбор без фото невозможен
  if (!target) throw new Error("Для автоподбора цветов нужно фото");
  // Подбираем
  return { keys: choosePalette(target, size, boardRgb(boardKey), count), board: boardKey };
}

/** Карта «сколько нити нужно» → серое изображение (чёрное — много нити). */
export function layerGray(cov: Float32Array): Uint8ClampedArray {
  // Каждая точка: 255·(1 − a)
  return Uint8ClampedArray.from(cov, (a) => Math.min(255, Math.max(0, rint(255 * (1 - a)))));
}

/** Серые карты для каждой нити. */
export function layerMaps(target: Float32Array, boardKey: string, keys: string[]): Uint8ClampedArray[] {
  // Покрытие каждой нитью
  return coverage(target, boardRgb(boardKey), keys.map(threadRgb)).map(layerGray);
}

/** Яркость цветной картинки (по точкам). */
export function lumOf(rgb: Float32Array): Float32Array {
  // Результат
  const out = new Float32Array(rgb.length / 3);
  // Каждая точка
  for (let p = 0; p < out.length; p++) out[p] = 0.299 * rgb[p * 3] + 0.587 * rgb[p * 3 + 1] + 0.114 * rgb[p * 3 + 2];
  // Яркость
  return out;
}

/** Счётчики нитей после каждых GRID линий: [0, 100, 200, …]. */
export function gridCounts(sequence: readonly number[], size = PROCESSING_SIZE): Uint16Array[] {
  // Начинаем с пустого
  const out = [new Uint16Array(size * size)];
  // Текущие счётчики
  const current = new Uint16Array(size * size);
  // Линии
  const cache = buildLineCache(size);
  // Каждые GRID линий
  for (let n = GRID; n < sequence.length; n += GRID) {
    // Добавляем очередные линии
    for (let i = n - GRID; i < n; i++) addLine(current, cache, sequence[i], sequence[i + 1]);
    // Снимок
    out.push(Uint16Array.from(current));
  }
  // Снимки
  return out;
}

/** Все слои поверх доски: цвета точек подряд (r, g, b…) в долях 0..1. */
export function composite(counts: Uint16Array[], colors: RGB[], board: RGB, keep: Float32Array): Float32Array {
  // Число точек
  const n = counts[0].length;
  // Холст цвета доски
  const canvas = new Float32Array(n * 3);
  // Последний индекс таблицы
  const top = keep.length - 1;
  // Красный доски
  const [b0, b1, b2] = board;
  // Заливаем доской
  for (let p = 0; p < n * 3; p += 3) {
    // Красный
    canvas[p] = b0;
    // Зелёный
    canvas[p + 1] = b1;
    // Синий
    canvas[p + 2] = b2;
  }
  // Каждый слой по порядку плетения
  for (let k = 0; k < counts.length; k++) {
    // Счётчики слоя
    const c = counts[k];
    // Цвет нити
    const [r, g, b] = colors[k];
    // Каждая точка
    for (let p = 0, q = 0; p < n; p++, q += 3) {
      // Нитей нет — цвет не меняется
      if (c[p] === 0) continue;
      // Сколько света проходит через нити этого слоя
      const t = keep[c[p] < top ? c[p] : top];
      // Доля нити
      const u = 1 - t;
      // Красный: старое × t + нить × (1 − t)
      canvas[q] = canvas[q] * t + r * u;
      // Зелёный
      canvas[q + 1] = canvas[q + 1] * t + g * u;
      // Синий
      canvas[q + 2] = canvas[q + 2] * t + b * u;
    }
  }
  // Картина
  return canvas;
}

// Размыть каждый канал цветной картинки
function blurRgb(rgb: Float32Array, size: number, sigma: number): Float32Array {
  // Результат
  const out = new Float32Array(rgb.length);
  // Каждый канал
  for (let c = 0; c < 3; c++) {
    // Канал отдельно
    const ch = new Float32Array(rgb.length / 3);
    // Копируем
    for (let p = 0; p < ch.length; p++) ch[p] = rgb[p * 3 + c];
    // Размываем
    const b = gaussianBlur(ch, size, size, sigma);
    // Обратно
    for (let p = 0; p < ch.length; p++) out[p * 3 + c] = b[p];
  }
  // Размытая картинка
  return out;
}

// Цветность внутри круга: цвет минус яркость (по точкам маски, подряд)
function chromaIn(rgb: Float32Array, mask: Uint8Array): Float32Array {
  // Сколько точек в круге
  const count = mask.reduce((s, v) => s + v, 0);
  // Результат
  const out = new Float32Array(count * 3);
  // Позиция
  let k = 0;
  // Каждая точка
  for (let p = 0; p < mask.length; p++) {
    // Снаружи — пропускаем
    if (!mask[p]) continue;
    // Яркость
    const l = 0.299 * rgb[p * 3] + 0.587 * rgb[p * 3 + 1] + 0.114 * rgb[p * 3 + 2];
    // Каждый канал
    for (let c = 0; c < 3; c++) out[k * 3 + c] = rgb[p * 3 + c] - l;
    // Дальше
    k++;
  }
  // Цветность
  return out;
}

/** Оценка всей картины: детали яркости как у одной нити минус ошибка цвета. */
export class Judge {
  // Сторона
  readonly size: number;
  // Доска
  readonly board: RGB;
  // Пропускание света
  readonly keep: Float32Array;
  // Оценщик деталей
  readonly scorer: Scorer;
  // Размытие цвета, px
  readonly sigma: number;
  // Маска круга
  readonly mask: Uint8Array;
  // Цветность фото
  readonly chroma: Float32Array;

  // Фото (цвета точек), доска, диаметр; size — сторона расчёта, оцениваем вдвое меньше
  constructor(target: Float32Array, board: RGB, diameterCm: number, size = PROCESSING_SIZE) {
    // Сторона расчёта (счётчики нитей)
    this.size = size;
    // Доска
    this.board = board;
    // Пропускание
    this.keep = keepTable(lineAlpha(size, diameterCm));
    // Фото, уменьшенное вдвое
    const small = half(target, size, 3);
    // Яркость фото
    const lum = lumOf(small);
    // Как в Python: байты 0..255
    for (let i = 0; i < lum.length; i++) lum[i] = Math.min(255, Math.max(0, rint(lum[i] * 255)));
    // Эталон яркости
    this.scorer = new Scorer(lum, diameterCm, size >> 1);
    // Размытие цвета в пикселях уменьшенной картинки
    this.sigma = COLOR_BLUR_MM / ((diameterCm * 10) / (size >> 1));
    // Маска
    this.mask = circleMask(size >> 1);
    // Цветность размытого фото
    this.chroma = chromaIn(blurRgb(small, size >> 1, this.sigma), this.mask);
  }

  /** Чем больше, тем картина ближе к фото. */
  score(counts: Uint16Array[], colors: RGB[]): number {
    // Картина, уменьшенная вдвое
    const comp = half(composite(counts, colors, this.board, this.keep), this.size, 3);
    // Яркость картины
    const lum = lumOf(comp);
    // В байтах 0..255
    for (let i = 0; i < lum.length; i++) lum[i] *= 255;
    // Детали яркости
    const detail = this.scorer.score(lum);
    // Цветность картины
    const ch = chromaIn(blurRgb(comp, this.size >> 1, this.sigma), this.mask);
    // Средний квадрат ошибки цвета
    let err = 0;
    // Каждое значение
    for (let i = 0; i < ch.length; i++) err += (ch[i] - this.chroma[i]) ** 2;
    // Итог
    return detail - (COLOR_WEIGHT * err) / ch.length;
  }
}

// Подбор числа линий в каждом слое: грубо по сетке, потом точнее
function fit(judge: Judge, grids: Uint16Array[][], colors: RGB[]): { idx: number[]; best: number } {
  // Уже оценённые наборы — повторы не считаем
  const memo = new Map<string, number>();
  // Оценка набора (с памятью)
  const value = (trial: number[]): number => {
    // Ключ набора
    const key = trial.join(",");
    // Уже считали
    const seen = memo.get(key);
    // Отдаём
    if (seen !== undefined) return seen;
    // Считаем
    const v = judge.score(grids.map((g, j) => g[trial[j]]), colors);
    // Запоминаем
    memo.set(key, v);
    // Отдаём
    return v;
  };
  // Начало: по 1000 линий
  let idx = grids.map((g) => Math.min(10, g.length - 1));
  // Оценка начала
  let best = value(idx);
  // Два грубых прохода и один точный
  for (const coarse of [true, true, false]) {
    // Каждый слой
    grids.forEach((grid, k) => {
      // Варианты: через 300 линий или ±200 вокруг текущего
      const options: number[] = [];
      // Грубо
      if (coarse) for (let i = 1; i < grid.length; i += 3) options.push(i);
      // Точно
      else for (let i = Math.max(1, idx[k] - 2); i < Math.min(grid.length, idx[k] + 3); i++) options.push(i);
      // Каждый вариант
      for (const i of options) {
        // Пробный набор
        const trial = [...idx];
        // Меняем один слой
        trial[k] = i;
        // Оценка
        const v = value(trial);
        // Лучше — берём
        if (v > best) {
          // Оценка
          best = v;
          // Набор
          idx = trial;
        }
      }
    });
  }
  // Итог
  return { idx, best };
}

/** Слой готового портрета. */
export interface BuiltLayer {
  // Ключ нити
  color: string;
  // Схема
  sequence: number[];
  // Сколько линий плести
  line_count: number;
}

/** Расчёт портрета из нескольких нитей; слои — в порядке плетения. */
export function buildLayers(
  // Фото (цвета точек)
  target: Float32Array,
  // Доска
  boardKey: string,
  // Нити
  keys: string[],
  // Карта важности
  importance: Float32Array | null,
  // Диаметр
  diameterCm: number,
  // Сторона
  size = PROCESSING_SIZE,
  // Сообщение о ходе расчёта
  progress: (note: string) => void = () => {},
// Возвращает слои в порядке плетения
): BuiltLayer[] {
  // Карты «сколько нити нужно»
  progress("Раскладываем фото по цветам нитей…");
  // Карты
  const maps = layerMaps(target, boardKey, keys);
  // Схемы по каждой нити
  const sequences = new Map<string, number[]>();
  // Каждая нить
  keys.forEach((key, i) => {
    // Сообщение
    progress(`Считаем нить ${i + 1} из ${keys.length}…`);
    // Схема
    sequences.set(key, generateSequence(targetMap(maps[i], size), MAX_LINES, undefined, importance));
  });
  // Одна нить — половина максимума
  if (keys.length === 1) return [{ color: keys[0], sequence: sequences.get(keys[0])!, line_count: MAX_LINES / 2 }];
  // Снимки счётчиков
  const grids = new Map(keys.map((k) => [k, gridCounts(sequences.get(k)!, size)]));
  // Оценщик
  const judge = new Judge(target, boardRgb(boardKey), diameterCm, size);
  // Лучший вариант
  let best: { value: number; order: string[]; idx: number[] } | null = null;
  // Сообщение
  progress("Подбираем, сколько линий каждой нити…");
  // Два порядка: светлые снизу и тёмные снизу
  for (const order of [weaveOrder(keys), weaveOrder(keys).reverse()]) {
    // Подбор
    const { idx, best: value } = fit(judge, order.map((k) => grids.get(k)!), order.map(threadRgb));
    // Лучше — запоминаем
    if (best === null || value > best.value) best = { value, order, idx };
  }
  // Слои в найденном порядке
  return best!.order.map((key, i) => ({ color: key, sequence: sequences.get(key)!, line_count: Math.max(LAYER_MIN_LINES, best!.idx[i] * GRID) }));
}

/** Кривая сходства для одной нити при неизменных остальных: [(линий, оценка)]. */
export function layerCurve(
  // Фото (цвета точек)
  target: Float32Array,
  // Доска
  boardKey: string,
  // Слои портрета
  layers: { color: string; sequence: number[]; line_count: number }[],
  // Какая нить
  k: number,
  // Диаметр
  diameterCm: number,
  // Сторона
  size = PROCESSING_SIZE,
// Возвращает точки кривой
): [number, number][] {
  // Оценщик
  const judge = new Judge(target, boardRgb(boardKey), diameterCm, size);
  // Цвета
  const colors = layers.map((l) => threadRgb(l.color));
  // Остальные нити — как сейчас
  const fixed = layers.map((l, i) => (i !== k ? lineCounts(l.sequence, l.line_count, size) : null));
  // Снимки нужной нити
  const grid = gridCounts(layers[k].sequence, size);
  // Результат
  const out: [number, number][] = [];
  // Каждые 200 линий от 100
  for (let i = LAYER_MIN_LINES / GRID; i < grid.length; i += 2) {
    // Счётчики: нужная нить — снимок, остальные — как есть
    const counts = fixed.map((c, j) => (j === k ? grid[i] : c!));
    // Точка
    out.push([i * GRID, Math.round(judge.score(counts, colors) * 1e4) / 1e4]);
  }
  // Кривая
  return out;
}

/** Справочник для фронтенда — как palette.catalog() на бэкенде. */
export function catalog() {
  // Режимы, нити, доски, ограничения
  return {
    // Режимы
    modes: [...MODES],
    // Нити
    threads: THREADS.map((t) => ({ ...t })),
    // Доски
    boards: BOARDS.map((b) => ({ ...b })),
    // Доска по умолчанию
    default_board: { ...DEFAULT_BOARD },
    // Сколько цветов
    colors: { min: MIN_COLORS, max: MAX_COLORS, default: DEFAULT_COLORS },
    // Меньше всего линий в слое
    layer_min_lines: LAYER_MIN_LINES,
  };
}
