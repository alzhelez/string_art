// Версия для телефона: насколько картина из нитей похожа на фото (как backend/app/similarity.py).
// Детали (основной вес): рисунок и фото слегка размываются, из каждой точки вычитается
// местная средняя яркость и делится на местный контраст; корреляция этих «карт деталей».
// Тон (вес 0,1): обычная корреляция яркостей при размытии 3 мм.

// Пиксели линий, расчёт схемы, карта цели, круглая маска
import { buildLineCache, circleMask, generateSequence, MAX_LINES, PROCESSING_SIZE, targetMap, addLine } from "./algorithm";
// Размытие
import { gaussianBlur } from "./blur";

// Меньше 1000 линий портрет не узнаётся
export const MIN_LINES = 1000;
// Размытие «глазом» для деталей, мм
export const DETAIL_SCALES_MM = [1.5, 3.0];
// Окно местной яркости и контраста, мм
export const LOCAL_WINDOW_MM = 8.0;
// Размытие для тона, мм
export const TONE_BLUR_MM = 3.0;
// Вес тона
export const TONE_WEIGHT = 0.1;
// Шаг кривой сходства, линий
export const CURVE_STEP = 100;
// Толщина лески, мм
export const THREAD_DIAMETER_MM = 0.2;

/** Непрозрачность линии толщиной 1 px: доля пикселя, которую закрывает леска. */
export function lineAlpha(size: number, diameterCm: number): number {
  // Размер пикселя в мм
  const pixelMm = (diameterCm * 10) / size;
  // Доля, но не меньше 0,02 и не больше 1
  return Math.min(1, Math.max(0.02, THREAD_DIAMETER_MM / pixelMm));
}

// Вычесть местную среднюю и поделить на местный контраст — остаются только детали
function localNormalize(a: Float32Array, size: number, sigma: number): Float32Array {
  // Местная средняя
  const mean = gaussianBlur(a, size, size, sigma);
  // Квадрат отклонения
  const sq = new Float32Array(a.length);
  // Каждый пиксель
  for (let i = 0; i < a.length; i++) sq[i] = (a[i] - mean[i]) ** 2;
  // Местная дисперсия
  const v = gaussianBlur(sq, size, size, sigma);
  // Результат
  const out = new Float32Array(a.length);
  // Нормированные детали (+25 — чтобы ровный фон не давал шум)
  for (let i = 0; i < a.length; i++) out[i] = (a[i] - mean[i]) / Math.sqrt(v[i] + 25);
  // Детали
  return out;
}

// Значения внутри круга за вычетом среднего и их длина
interface Centered {
  // Вектор
  v: Float64Array;
  // Длина (не ноль)
  norm: number;
}

// Взять пиксели внутри круга и центрировать
function centered(a: Float32Array, mask: Uint8Array, count: number): Centered {
  // Вектор
  const v = new Float64Array(count);
  // Сумма для среднего
  let sum = 0;
  // Позиция в векторе
  let k = 0;
  // Каждый пиксель круга
  for (let i = 0; i < a.length; i++) {
    // Снаружи — пропускаем
    if (!mask[i]) continue;
    // Значение
    v[k++] = a[i];
    // Сумма
    sum += a[i];
  }
  // Среднее
  const mean = sum / count;
  // Сумма квадратов
  let sq = 0;
  // Центрируем
  for (let i = 0; i < count; i++) {
    // Минус среднее
    v[i] -= mean;
    // Квадрат
    sq += v[i] * v[i];
  }
  // Вектор и длина
  return { v, norm: Math.sqrt(sq) || 1 };
}

// Корреляция двух центрированных векторов
function corr(a: Centered, b: Centered): number {
  // Скалярное произведение
  let dot = 0;
  // Каждая координата
  for (let i = 0; i < a.v.length; i++) dot += a.v[i] * b.v[i];
  // Нормируем
  return dot / (a.norm * b.norm);
}

/** Готовит эталон один раз и оценивает много рендеров. */
export class Scorer {
  // Сторона квадрата
  readonly size: number;
  // Мм на пиксель
  readonly px: number;
  // Маска круга
  readonly mask: Uint8Array;
  // Пикселей в круге
  readonly count: number;
  // Окно местной нормировки, px
  readonly window: number;
  // Эталонные детали для каждого масштаба
  readonly details: Centered[];
  // Эталонный тон
  readonly tone: Centered;

  // Эталон: яркости 0..255, size×size
  constructor(reference: Float32Array, diameterCm: number, size = PROCESSING_SIZE) {
    // Сторона
    this.size = size;
    // Мм на пиксель
    this.px = (diameterCm * 10) / size;
    // Маска круга
    this.mask = circleMask(size);
    // Пикселей в круге
    this.count = this.mask.reduce((s, v) => s + v, 0);
    // Окно
    this.window = LOCAL_WINDOW_MM / this.px;
    // Детали эталона
    this.details = DETAIL_SCALES_MM.map((mm) =>
      // Размыли, нормировали, центрировали
      centered(localNormalize(gaussianBlur(reference, size, size, mm / this.px), size, this.window), this.mask, this.count),
    );
    // Тон эталона
    this.tone = centered(gaussianBlur(reference, size, size, TONE_BLUR_MM / this.px), this.mask, this.count);
  }

  /** Сходство рендера (яркости 0..255) с эталоном. */
  score(render: Float32Array): number {
    // Сумма по масштабам деталей
    let detail = 0;
    // Каждый масштаб
    DETAIL_SCALES_MM.forEach((mm, i) => {
      // Детали рендера
      const d = centered(localNormalize(gaussianBlur(render, this.size, this.size, mm / this.px), this.size, this.window), this.mask, this.count);
      // Корреляция с эталоном
      detail += corr(d, this.details[i]);
    });
    // Среднее по масштабам
    detail /= DETAIL_SCALES_MM.length;
    // Тон рендера
    const tone = corr(centered(gaussianBlur(render, this.size, this.size, TONE_BLUR_MM / this.px), this.mask, this.count), this.tone);
    // Итог: детали + немного тона
    return (detail + TONE_WEIGHT * tone) / (1 + TONE_WEIGHT);
  }
}

/** Таблица (1 − α)^k: сколько света проходит через k нитей. */
export function keepTable(alpha: number, max = 4096): Float32Array {
  // Таблица
  const t = new Float32Array(max + 1);
  // Каждое число нитей
  for (let k = 0; k <= max; k++) t[k] = (1 - alpha) ** k;
  // Таблица
  return t;
}

/** Рендер картины по счётчикам нитей: яркости 0..255. */
export function renderGray(counts: Uint16Array, keep: Float32Array): Float32Array {
  // Результат
  const out = new Float32Array(counts.length);
  // Каждый пиксель: белое × пропущенный свет
  for (let i = 0; i < counts.length; i++) out[i] = 255 * keep[Math.min(counts[i], keep.length - 1)];
  // Рендер
  return out;
}

/** Уменьшить картинку вдвое усреднением квадратов 2×2 (каналов — channels). */
export function half(a: Float32Array, size: number, channels = 1): Float32Array {
  // Новая сторона
  const s = size >> 1;
  // Результат
  const out = new Float32Array(s * s * channels);
  // Каждая строка
  for (let y = 0; y < s; y++) {
    // Каждый столбец
    for (let x = 0; x < s; x++) {
      // Каждый канал
      for (let c = 0; c < channels; c++) {
        // Левый верхний пиксель квадрата
        const i = ((y * 2) * size + x * 2) * channels + c;
        // Среднее четырёх
        out[(y * s + x) * channels + c] = (a[i] + a[i + channels] + a[i + size * channels] + a[i + size * channels + channels]) / 4;
      }
    }
  }
  // Уменьшенная картинка
  return out;
}

// Сторона, на которой оцениваем сходство: вдвое меньше расчётной — в 4 раза быстрее на телефоне
export const SCORE_SIZE = PROCESSING_SIZE / 2;

// Округление до 4 знаков
const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** [(число линий, сходство), …] от start до stop с шагом step. */
export function similarityCurve(
  // Схема
  sequence: readonly number[],
  // Эталон: яркости 0..255
  reference: Float32Array,
  // Диаметр
  diameterCm: number,
  // Начало
  start = MIN_LINES,
  // Конец
  stop: number | null = null,
  // Шаг
  step = CURVE_STEP,
  // Сторона квадрата
  size = PROCESSING_SIZE,
// Возвращает точки кривой
): [number, number][] {
  // Конец — не дальше схемы
  const end = Math.min(stop ?? MAX_LINES, sequence.length - 1);
  // Схема короче начала
  if (end < start) throw new RangeError("Последовательность короче минимального числа линий");
  // Оценщик — на уменьшенной вдвое картинке
  const scorer = new Scorer(half(reference, size), diameterCm, size >> 1);
  // Пропускание света
  const keep = keepTable(lineAlpha(size, diameterCm));
  // Линии
  const cache = buildLineCache(size);
  // Счётчики нитей
  const counts = new Uint16Array(size * size);
  // Результат
  const out: [number, number][] = [];
  // Сколько линий уже добавлено
  let done = 0;
  // Каждая точка кривой
  for (let n = start; n <= end; n += step) {
    // Добавляем линии до n
    for (; done < n; done++) addLine(counts, cache, sequence[done], sequence[done + 1]);
    // Оценка
    out.push([n, round4(scorer.score(half(renderGray(counts, keep), size)))]);
  }
  // Кривая
  return out;
}

/** Максимум сходства; при равенстве — меньше линий. */
export function bestPoint(curve: [number, number][]): [number, number] {
  // Лучшая точка
  let best = curve[0];
  // Каждая точка
  for (const p of curve) {
    // Выше — или так же, но меньше линий
    if (p[1] > best[1] || (p[1] === best[1] && p[0] < best[0])) best = p;
  }
  // Точка
  return best;
}

// Контрасты для автонастройки
export const AUTO_CONTRASTS = [-0.3, -0.15, 0.0, 0.25];
// Яркости
export const AUTO_BRIGHTNESS = [-0.12, 0.12];

/** Итог автонастройки — как AutoToneOut на бэкенде. */
export interface AutoToneResult {
  // Яркость
  brightness: number;
  // Контраст
  contrast: number;
  // Сходство без коррекций
  score_before: number;
  // Сходство с найденными
  score_after: number;
  // Лучшее число линий без коррекций
  lines_before: number;
  // Лучшее число линий с ними
  best_lines: number;
  // Сколько вариантов перебрали
  candidates: number;
}

/**
 * Подбор яркости и контраста, при которых нитяная картина больше всего похожа на фото.
 * prepare(brightness, contrast) → подготовленное серое изображение size×size.
 */
export function autoTone(
  // Подготовка фото с коррекциями
  prepare: (b: number, c: number) => Uint8ClampedArray,
  // Диаметр
  diameterCm: number,
  // Карта важности
  importance: Float32Array | null = null,
  // Сторона квадрата
  size = PROCESSING_SIZE,
// Возвращает лучшие яркость и контраст
): AutoToneResult {
  // Эталон — фото без коррекций
  const reference = Float32Array.from(prepare(0, 0));
  // Уже посчитанные варианты: «b|c» → [линии, сходство]
  const tried = new Map<string, [number, number]>();
  // Оценить вариант (один раз)
  const score = (b: number, c: number): [number, number] => {
    // Ключ
    const key = `${b}|${c}`;
    // Уже есть
    const ready = tried.get(key);
    // Отдаём
    if (ready) return ready;
    // Схема на 5000 линий
    const seq = generateSequence(targetMap(prepare(b, c), size), MAX_LINES, undefined, importance);
    // Лучшая точка кривой с шагом 250
    const best = bestPoint(similarityCurve(seq, reference, diameterCm, MIN_LINES, MAX_LINES, 250, size));
    // Запоминаем
    tried.set(key, best);
    // Отдаём
    return best;
  };
  // Сначала контраст
  for (const c of AUTO_CONTRASTS) score(0, c);
  // Лучший контраст
  const bestC = AUTO_CONTRASTS.reduce((a, c) => (score(0, c)[1] > score(0, a)[1] ? c : a));
  // Потом яркость при нём
  for (const b of AUTO_BRIGHTNESS) score(b, bestC);
  // Лучший вариант из всех (при равенстве — посчитанный раньше, как в Python)
  let bestKey = tried.keys().next().value as string;
  // Перебор
  for (const [key, v] of tried) if (v[1] > tried.get(bestKey)![1]) bestKey = key;
  // Яркость и контраст лучшего
  const [b, c] = bestKey.split("|").map(Number);
  // Его линии и сходство
  const [lines, s] = tried.get(bestKey)!;
  // Без коррекций
  const [beforeLines, before] = tried.get("0|0")!;
  // Итог
  return { brightness: b, contrast: c, score_before: before, score_after: s, lines_before: beforeLines, best_lines: lines, candidates: tried.size };
}
