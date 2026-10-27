// План смены катушки: на каком шаге закончится леска и где завязать узел, чтобы его не было видно.
import { THREAD_MARGIN, TOTAL_NAILS } from "./constants";
import { nailLabel } from "./nails";
import { cumulativeLengthsM } from "./thread";

/** На концы для узлов у каждой катушки уходит около полуметра. */
export const KNOT_TAILS_M = 0.5;
/** Где искать место для узла: последние 3 % длины катушки. */
const WINDOW_SHARE = 0.03;

export interface SpoolChange {
  /** Номер катушки, которая заканчивается (с 1). */
  spool: number;
  /** После этого шага завязать узел и взять новую катушку. */
  afterStep: number;
  nail: number;
  label: string;
  /** Сколько лески к этому моменту уйдёт с учётом запаса, м. */
  usedM: number;
}

/**
 * Узел ставится на гвоздь, через который проходит больше всего нитей: среди них его не видно.
 * Расход считается с тем же запасом, что и катушка (15 %), — леска кончится не раньше плана.
 */
export function planSpools(
  sequence: readonly number[],
  steps: number,
  diameterCm: number,
  spoolM: number,
  margin = THREAD_MARGIN,
): { changes: SpoolChange[]; spools: number } {
  if (!(spoolM > KNOT_TAILS_M * 4)) return { changes: [], spools: 1 };
  const raw = cumulativeLengthsM(sequence.slice(0, steps + 1), diameterCm);
  const used = (i: number) => raw[i] * (1 + margin);
  const usage = new Uint32Array(TOTAL_NAILS);
  for (let i = 0; i <= steps; i++) usage[sequence[i]]++;

  const changes: SpoolChange[] = [];
  let start = 0;
  while (used(steps) - used(start) > spoolM - KNOT_TAILS_M) {
    const limit = used(start) + spoolM - KNOT_TAILS_M;
    let end = start;
    while (end + 1 <= steps && used(end + 1) <= limit) end++;
    if (end === start) break; // катушка короче одной нити — планировать нечего
    let best = end;
    for (let i = end; i > start && used(end) - used(i) <= spoolM * WINDOW_SHARE; i--) {
      if (usage[sequence[i]] > usage[sequence[best]]) best = i;
    }
    changes.push({
      spool: changes.length + 1,
      afterStep: best,
      nail: sequence[best],
      label: nailLabel(sequence[best]),
      usedM: Math.round(used(best) * 10) / 10,
    });
    start = best;
  }
  return { changes, spools: changes.length + 1 };
}

/** Ближайшая смена катушки впереди (или null). */
export function nextChange(changes: readonly SpoolChange[], step: number): SpoolChange | null {
  return changes.find((c) => c.afterStep >= step) ?? null;
}
