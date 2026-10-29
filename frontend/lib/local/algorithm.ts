// Версия для телефона: жадный алгоритм string art — тот же, что backend/app/algorithm.py.
// На каждом шаге из текущего гвоздя пробуем все допустимые гвозди и берём линию,
// под которой картинка в среднем темнее всего, затем «стираем» её с карты темноты.

// Число гвоздей
import { TOTAL_NAILS } from "../constants";
// Координаты гвоздя и расстояние между гвоздями по кругу
import { nailGap, nailXY } from "../nails";
// Размытие по Гауссу (для резкости)
import { gaussianBlur } from "./blur";

// Сторона квадрата, в котором считается картина (как PROCESSING_SIZE на бэкенде)
export const PROCESSING_SIZE = 400;
// Минимальная «дистанция» между гвоздями одной линии
export const MIN_NAIL_GAP = 15;
// Сколько «темноты» снимает одна линия
export const LINE_WEIGHT = 0.12;
// Гамма целевой картинки: светлый фон получает меньше линий
export const TARGET_GAMMA = 1.2;
// Номер стартового гвоздя (A1)
export const START_NAIL = 0;
// Сколько линий считаем всегда (ползунок берёт префикс)
export const MAX_LINES = 5000;

// Округление как numpy.rint: ровно посередине — к чётному
export function rint(v: number): number {
  // Целая часть
  const f = Math.floor(v);
  // Дробная часть
  const d = v - f;
  // Больше половины — вверх
  if (d > 0.5) return f + 1;
  // Меньше половины — вниз
  if (d < 0.5) return f;
  // Ровно половина — к чётному
  return f % 2 === 0 ? f : f + 1;
}

/** Плоские индексы пикселей прямой между гвоздями a и b (как line_pixels в Python). */
// Пиксели линии
export function linePixels(a: number, b: number, size: number): Int32Array {
  // Радиус круга гвоздей в пикселях
  const r = size / 2 - 0.5;
  // Центр
  const c = (size - 1) / 2;
  // Первый гвоздь
  const [x0, y0] = nailXY(a, r, c, c);
  // Второй гвоздь
  const [x1, y1] = nailXY(b, r, c, c);
  // Точек на линии: длина + 1 (как np.linspace)
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) + 1;
  // Результат с запасом
  const out = new Int32Array(n);
  // Сколько уже записали
  let k = 0;
  // Предыдущий пиксель (чтобы не повторять)
  let prev = -1;
  // Каждая точка
  for (let i = 0; i < n; i++) {
    // Доля пути (последняя точка — ровно конец, как в linspace)
    const t = i === n - 1 ? 1 : i / (n - 1);
    // Столбец: округление и обрезка по краю
    const x = Math.min(size - 1, Math.max(0, rint(i === n - 1 ? x1 : x0 + (x1 - x0) * t)));
    // Строка
    const y = Math.min(size - 1, Math.max(0, rint(i === n - 1 ? y1 : y0 + (y1 - y0) * t)));
    // Плоский индекс
    const flat = y * size + x;
    // Подряд одинаковые — пропускаем
    if (flat !== prev) out[k++] = flat;
    // Запоминаем
    prev = flat;
  }
  // Только записанное
  return out.slice(0, k);
}

/** Все линии, упакованные подряд: каждая пара гвоздей хранится один раз. */
export interface LineCache {
  // Сторона квадрата
  size: number;
  // Для гвоздя a — список гвоздей, куда можно тянуть нить
  targets: Int32Array[];
  // Для пары (a·240+b) — начало её пикселей в pixels (−1 — пары нет)
  offset: Int32Array;
  // Для пары — число пикселей
  count: Int32Array;
  // Пиксели всех линий подряд
  pixels: Int32Array;
}

// Готовые кэши по стороне квадрата (считаются один раз)
const caches = new Map<number, LineCache>();

/** Предрасчёт всех линий (~0,5–1 с, один раз). */
// Кэш линий
export function buildLineCache(size = PROCESSING_SIZE, minGap = MIN_NAIL_GAP): LineCache {
  // Ключ кэша
  const key = size * 1000 + minGap;
  // Уже есть
  const ready = caches.get(key);
  // Отдаём
  if (ready) return ready;
  // Начала пар
  const offset = new Int32Array(TOTAL_NAILS * TOTAL_NAILS).fill(-1);
  // Длины пар
  const count = new Int32Array(TOTAL_NAILS * TOTAL_NAILS);
  // Пиксели пар по очереди
  const parts: Int32Array[] = [];
  // Общая длина
  let total = 0;
  // Каждая пара a < b
  for (let a = 0; a < TOTAL_NAILS; a++) {
    // Второй гвоздь
    for (let b = a + 1; b < TOTAL_NAILS; b++) {
      // Слишком близкие — пропускаем
      if (nailGap(a, b) < minGap) continue;
      // Пиксели
      const px = linePixels(a, b, size);
      // Начало — одинаковое для (a, b) и (b, a)
      offset[a * TOTAL_NAILS + b] = offset[b * TOTAL_NAILS + a] = total;
      // Длина
      count[a * TOTAL_NAILS + b] = count[b * TOTAL_NAILS + a] = px.length;
      // Копим
      parts.push(px);
      // Сдвиг
      total += px.length;
    }
  }
  // Один большой массив
  const pixels = new Int32Array(total);
  // Позиция записи
  let pos = 0;
  // Каждая пара
  for (const px of parts) {
    // Копируем
    pixels.set(px, pos);
    // Сдвиг
    pos += px.length;
  }
  // Куда можно тянуть из каждого гвоздя (по возрастанию — как в Python)
  const targets = Array.from({ length: TOTAL_NAILS }, (_, a) =>
    // Все гвозди, кроме себя и слишком близких
    Int32Array.from({ length: TOTAL_NAILS }, (_, b) => b).filter((b) => b !== a && nailGap(a, b) >= minGap),
  );
  // Кэш
  const cache = { size, targets, offset, count, pixels };
  // Запоминаем
  caches.set(key, cache);
  // Отдаём
  return cache;
}

/**
 * Последовательность гвоздей длиной maxLines + 1 (первый — стартовый).
 * importance — карта весов (1 — обычная важность, 2 — вдвое важнее).
 */
// Расчёт схемы
export function generateSequence(
  // Карта темноты 0..1, size×size
  darkness: Float32Array,
  // Сколько линий
  maxLines = MAX_LINES,
  // Сила одной линии
  lineWeight = LINE_WEIGHT,
  // Карта важности
  importance: Float32Array | null = null,
// Возвращает схему: номера гвоздей по порядку
): number[] {
  // Сторона квадрата
  const size = Math.round(Math.sqrt(darkness.length));
  // Карта должна быть квадратной
  if (size * size !== darkness.length) throw new RangeError("Карта темноты должна быть квадратной");
  // Карта важности того же размера
  if (importance && importance.length !== darkness.length) throw new RangeError("Карта важности должна совпадать по размеру");
  // Хотя бы одна линия
  if (maxLines < 1) throw new RangeError("maxLines должен быть >= 1");
  // Линии
  const cache = buildLineCache(size);
  // Рабочая копия карты (её «стираем»)
  const work = Float32Array.from(darkness);
  // Уже натянутые пары
  const used = new Uint8Array(TOTAL_NAILS * TOTAL_NAILS);
  // Результат
  const sequence = [START_NAIL];
  // Текущий гвоздь
  let current = START_NAIL;
  // Каждая линия
  for (let step = 0; step < maxLines; step++) {
    // Куда можно тянуть
    const targets = cache.targets[current];
    // Лучшая оценка
    let best = -Infinity;
    // Лучший гвоздь
    let next = -1;
    // Каждый кандидат
    for (let t = 0; t < targets.length; t++) {
      // Гвоздь-кандидат
      const b = targets[t];
      // Номер пары
      const pair = current * TOTAL_NAILS + b;
      // Уже натянута — нельзя
      if (used[pair]) continue;
      // Начало пикселей
      const start = cache.offset[pair];
      // Конец
      const end = start + cache.count[pair];
      // Сумма темноты под линией
      let sum = 0;
      // Без важности — просто сумма
      if (importance === null) {
        // Каждый пиксель
        for (let i = start; i < end; i++) sum += work[cache.pixels[i]];
        // С важностью
      } else {
        // Каждый пиксель с весом
        for (let i = start; i < end; i++) sum += work[cache.pixels[i]] * importance[cache.pixels[i]];
      }
      // Средняя темнота
      const score = sum / cache.count[pair];
      // Лучше прежней (при равенстве — первая, как argmax)
      if (score > best) {
        // Запоминаем
        best = score;
        // Гвоздь
        next = b;
      }
    }
    // Кандидатов не осталось (на практике не бывает)
    if (next < 0) break;
    // Пиксели выбранной линии
    const pair = current * TOTAL_NAILS + next;
    // Начало
    const start = cache.offset[pair];
    // Конец
    const end = start + cache.count[pair];
    // «Стираем» линию
    for (let i = start; i < end; i++) work[cache.pixels[i]] -= lineWeight;
    // Пара занята в обе стороны
    used[pair] = used[next * TOTAL_NAILS + current] = 1;
    // В схему
    sequence.push(next);
    // Переходим
    current = next;
  }
  // Готовая схема
  return sequence;
}

/** Круглая маска: true — внутри круга. */
export function circleMask(size: number): Uint8Array {
  // Результат
  const mask = new Uint8Array(size * size);
  // Центр
  const c = (size - 1) / 2;
  // Квадрат радиуса
  const r2 = (size / 2) ** 2;
  // Каждая строка
  for (let y = 0; y < size; y++) {
    // Каждый столбец
    for (let x = 0; x < size; x++) mask[y * size + x] = (x - c) ** 2 + (y - c) ** 2 <= r2 ? 1 : 0;
  }
  // Маска
  return mask;
}

/** Резкость как PIL UnsharpMask(radius=3, percent=120, threshold=2): гуще мелкие детали. */
export function unsharp(gray: Uint8ClampedArray | Uint8Array, size: number, radius = 3, percent = 120, threshold = 2): Uint8ClampedArray {
  // Размытая копия
  const blur = gaussianBlur(Float32Array.from(gray), size, size, radius);
  // Результат
  const out = new Uint8ClampedArray(gray.length);
  // Каждый пиксель
  for (let i = 0; i < gray.length; i++) {
    // Разница с размытым (как в PIL — по округлённому размытому)
    const diff = gray[i] - Math.round(blur[i]);
    // Маленькая разница — без изменений, большая — усиливаем (целочисленно, как в PIL)
    out[i] = Math.abs(diff) < threshold ? gray[i] : gray[i] + Math.trunc((diff * percent) / 100);
  }
  // Резкая картинка
  return out;
}

/** Карта, которую «рисует» алгоритм: резкость + темнота + гамма; вне круга — 0. */
export function targetMap(gray: Uint8ClampedArray | Uint8Array, size: number, gamma = TARGET_GAMMA): Float32Array {
  // Резкость
  const sharp = unsharp(gray, size);
  // Маска круга
  const mask = circleMask(size);
  // Результат
  const out = new Float32Array(gray.length);
  // Каждый пиксель: темнота в степени гаммы, вне круга — 0
  for (let i = 0; i < out.length; i++) out[i] = mask[i] ? (1 - sharp[i] / 255) ** gamma : 0;
  // Карта
  return out;
}

/** Сколько раз нить проходит через каждый пиксель за первые steps линий. */
export function lineCounts(sequence: readonly number[], steps: number, size: number): Uint16Array {
  // Счётчики
  const counts = new Uint16Array(size * size);
  // Не больше длины схемы
  const n = Math.max(0, Math.min(steps, sequence.length - 1));
  // Нестандартный размер (превью) — пиксели линий на лету, без большого кэша
  if (size !== PROCESSING_SIZE) {
    // Каждая линия
    for (let i = 0; i < n; i++) for (const p of linePixels(sequence[i], sequence[i + 1], size)) counts[p]++;
    // Счётчики
    return counts;
  }
  // Кэш линий
  const cache = buildLineCache(size);
  // Каждая линия
  for (let i = 0; i < n; i++) addLine(counts, cache, sequence[i], sequence[i + 1]);
  // Счётчики
  return counts;
}

/** Добавить одну линию к счётчикам. */
export function addLine(counts: Uint16Array, cache: LineCache, a: number, b: number): void {
  // Номер пары
  const pair = a * TOTAL_NAILS + b;
  // Начало пикселей
  const start = cache.offset[pair];
  // Пары нет (слишком близкие гвозди — из чужого файла) — считаем на лету
  if (start < 0) {
    // Пиксели линии
    for (const p of linePixels(a, b, cache.size)) counts[p]++;
    // Готово
    return;
  }
  // Конец
  const end = start + cache.count[pair];
  // Каждый пиксель
  for (let i = start; i < end; i++) counts[cache.pixels[i]]++;
}
