// Расчёт лески и катушки — зеркало backend/app/thread.py.
// На фронтенде считаем сами, чтобы цифры менялись мгновенно при движении ползунка.
import {
  BIG_SPOOL_M,
  LINES_PER_CM,
  MAX_LINES,
  MIN_LINES,
  STANDARD_SPOOLS_M,
  THREAD_MARGIN,
} from "./constants";
import { arcSpacing, chordLength } from "./nails";

export interface ThreadStats {
  steps: number;
  diameter_cm: number;
  raw_length_m: number;
  margin: number;
  total_length_m: number;
  spool_m: number;
  spool_count: number;
  nail_spacing_mm: number;
}

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/** Накопленная длина без запаса после каждого шага: [0, l1, l1+l2, ...], метры. */
export function cumulativeLengthsM(sequence: readonly number[], diameterCm: number): Float64Array {
  const d = diameterCm / 100;
  const out = new Float64Array(sequence.length);
  for (let i = 1; i < sequence.length; i++) {
    out[i] = out[i - 1] + chordLength(sequence[i - 1], sequence[i], d);
  }
  return out;
}

export function rawLengthM(sequence: readonly number[], steps: number, diameterCm: number): number {
  if (steps < 0 || steps > sequence.length - 1) throw new RangeError("steps вне диапазона");
  const d = diameterCm / 100;
  let sum = 0;
  for (let i = 0; i < steps; i++) sum += chordLength(sequence[i], sequence[i + 1], d);
  return sum;
}

export function pickSpool(lengthM: number): { spool: number; count: number } {
  if (lengthM < 0) throw new RangeError("Длина не может быть отрицательной");
  for (const spool of STANDARD_SPOOLS_M) {
    if (lengthM <= spool) return { spool, count: 1 };
  }
  return { spool: BIG_SPOOL_M, count: Math.ceil(lengthM / BIG_SPOOL_M) };
}

export function threadStats(
  sequence: readonly number[],
  steps: number,
  diameterCm: number,
  margin = THREAD_MARGIN,
): ThreadStats {
  const raw = rawLengthM(sequence, steps, diameterCm);
  const total = raw * (1 + margin);
  const { spool, count } = pickSpool(total);
  return {
    steps,
    diameter_cm: diameterCm,
    raw_length_m: round(raw, 2),
    margin,
    total_length_m: round(total, 1),
    spool_m: spool,
    spool_count: count,
    nail_spacing_mm: round(arcSpacing(diameterCm * 10), 2),
  };
}

export function recommendedLines(diameterCm: number): number {
  // В Python round() банковский, но при диаметре с точностью 0,1 см и 40 линиях на см
  // значение вида «x,5» не возникает, поэтому Math.round даёт тот же результат.
  const value = Math.round((diameterCm * LINES_PER_CM) / 100) * 100;
  return Math.min(MAX_LINES, Math.max(MIN_LINES, value));
}

export function spoolText(stats: Pick<ThreadStats, "spool_m" | "spool_count">): string {
  const size = new Intl.NumberFormat("ru-RU").format(stats.spool_m);
  return stats.spool_count === 1 ? `${size} м` : `${stats.spool_count} × ${size} м`;
}
