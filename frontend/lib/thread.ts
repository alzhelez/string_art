// Расчёт лески и катушки — зеркало backend/app/thread.py.
// На фронтенде считаем сами, чтобы цифры менялись мгновенно при движении ползунка.
// Константы (те же, что на бэкенде)
import {
  // Большая катушка
  BIG_SPOOL_M,
  // Линий на сантиметр
  LINES_PER_CM,
  // Максимум линий
  MAX_LINES,
  // Минимум линий
  MIN_LINES,
  // Стандартные катушки
  STANDARD_SPOOLS_M,
  // Запас
  THREAD_MARGIN,
} from "./constants";
// Шаг гвоздей и длина хорды
import { arcSpacing, chordLength } from "./nails";

// Сводка по леске (поля как в ответе бэкенда)
export interface ThreadStats {
  // Число линий
  steps: number;
  // Диаметр
  diameter_cm: number;
  // Длина без запаса, м
  raw_length_m: number;
  // Запас
  margin: number;
  // Длина с запасом, м
  total_length_m: number;
  // Катушка, м
  spool_m: number;
  // Сколько катушек
  spool_count: number;
  // Шаг гвоздей, мм
  nail_spacing_mm: number;
}

// Округление до digits знаков после запятой
const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/** Накопленная длина без запаса после каждого шага: [0, l1, l1+l2, ...], метры. */
// Накопленная длина лески
export function cumulativeLengthsM(sequence: readonly number[], diameterCm: number): Float64Array {
  // Диаметр в метрах
  const d = diameterCm / 100;
  // Массив чисел той же длины, что последовательность (out[0] = 0)
  const out = new Float64Array(sequence.length);
  // Для каждого шага
  for (let i = 1; i < sequence.length; i++) {
    // Предыдущая сумма + длина отрезка
    out[i] = out[i - 1] + chordLength(sequence[i - 1], sequence[i], d);
  }
  // Готово
  return out;
}

// Длина первых steps линий без запаса
export function rawLengthM(sequence: readonly number[], steps: number, diameterCm: number): number {
  // Проверка диапазона
  if (steps < 0 || steps > sequence.length - 1) throw new RangeError("steps вне диапазона");
  // Диаметр в метрах
  const d = diameterCm / 100;
  // Сумма
  let sum = 0;
  // Складываем длины отрезков
  for (let i = 0; i < steps; i++) sum += chordLength(sequence[i], sequence[i + 1], d);
  // Результат
  return sum;
}

// Подбор катушки
export function pickSpool(lengthM: number): { spool: number; count: number } {
  // Отрицательная длина — ошибка
  if (lengthM < 0) throw new RangeError("Длина не может быть отрицательной");
  // От короткой к длинной
  for (const spool of STANDARD_SPOOLS_M) {
    // Первая подходящая
    if (lengthM <= spool) return { spool, count: 1 };
  }
  // Иначе — несколько больших
  return { spool: BIG_SPOOL_M, count: Math.ceil(lengthM / BIG_SPOOL_M) };
}

// Полная сводка по леске
export function threadStats(
  // Последовательность гвоздей
  sequence: readonly number[],
  // Число линий
  steps: number,
  // Диаметр
  diameterCm: number,
  // Запас
  margin = THREAD_MARGIN,
// Возвращает сводку
): ThreadStats {
  // Без запаса
  const raw = rawLengthM(sequence, steps, diameterCm);
  // С запасом
  const total = raw * (1 + margin);
  // Катушка
  const { spool, count } = pickSpool(total);
  // Сводка
  return {
    // Линий
    steps,
    // Диаметр
    diameter_cm: diameterCm,
    // Без запаса, до сантиметра
    raw_length_m: round(raw, 2),
    // Запас
    margin,
    // С запасом, до 10 см
    total_length_m: round(total, 1),
    // Катушка
    spool_m: spool,
    // Количество
    spool_count: count,
    // Шаг гвоздей в мм (диаметр в мм = см × 10)
    nail_spacing_mm: round(arcSpacing(diameterCm * 10), 2),
  };
}

// Ориентир числа линий по диаметру
export function recommendedLines(diameterCm: number): number {
  // В Python round() банковский, но при диаметре с точностью 0,1 см и 40 линиях на см
  // значение вида «x,5» не возникает, поэтому Math.round даёт тот же результат.
  // 40 линий на см, округлено до сотни
  const value = Math.round((diameterCm * LINES_PER_CM) / 100) * 100;
  // В пределах 1000…5000
  return Math.min(MAX_LINES, Math.max(MIN_LINES, value));
}

// Катушка текстом: «500 м» или «3 × 1 000 м»
export function spoolText(stats: Pick<ThreadStats, "spool_m" | "spool_count">): string {
  // Длина с пробелами между разрядами
  const size = new Intl.NumberFormat("ru-RU").format(stats.spool_m);
  // Одна катушка или несколько
  return stats.spool_count === 1 ? `${size} м` : `${stats.spool_count} × ${size} м`;
}
