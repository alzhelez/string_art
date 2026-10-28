// План смены катушки: на каком шаге закончится леска и где завязать узел, чтобы его не было видно.
// Запас и число гвоздей
import { THREAD_MARGIN, TOTAL_NAILS } from "./constants";
// Метка гвоздя
import { nailLabel } from "./nails";
// Накопленная длина лески
import { cumulativeLengthsM } from "./thread";

/** На концы для узлов у каждой катушки уходит около полуметра. */
// Запас на концы узлов, м
export const KNOT_TAILS_M = 0.5;
/** Где искать место для узла: последние 3 % длины катушки. */
// Доля катушки, в которой выбираем место узла
const WINDOW_SHARE = 0.03;

// Одна смена катушки
export interface SpoolChange {
  /** Номер катушки, которая заканчивается (с 1). */
  spool: number;
  /** После этого шага завязать узел и взять новую катушку. */
  afterStep: number;
  // Гвоздь, на котором завязать узел
  nail: number;
  // Его метка
  label: string;
  /** Сколько лески к этому моменту уйдёт с учётом запаса, м. */
  usedM: number;
}

/**
 * Узел ставится на гвоздь, через который проходит больше всего нитей: среди них его не видно.
 * Расход считается с тем же запасом, что и катушка (15 %), — леска кончится не раньше плана.
 */
// Построить план смен катушек
export function planSpools(
  // Последовательность гвоздей
  sequence: readonly number[],
  // Сколько линий плетём
  steps: number,
  // Диаметр
  diameterCm: number,
  // Длина одной своей катушки
  spoolM: number,
  // Запас
  margin = THREAD_MARGIN,
// Возвращает смены и общее число катушек
): { changes: SpoolChange[]; spools: number } {
  // Слишком короткая или некорректная катушка (NaN тоже сюда) — плана нет
  if (!(spoolM > KNOT_TAILS_M * 4)) return { changes: [], spools: 1 };
  // Накопленная длина без запаса до выбранного числа линий
  const raw = cumulativeLengthsM(sequence.slice(0, steps + 1), diameterCm);
  // Расход с запасом после шага i
  const used = (i: number) => raw[i] * (1 + margin);
  // Сколько раз нить проходит через каждый гвоздь
  const usage = new Uint32Array(TOTAL_NAILS);
  // Считаем
  for (let i = 0; i <= steps; i++) usage[sequence[i]]++;

  // Список смен
  const changes: SpoolChange[] = [];
  // Шаг, с которого началась текущая катушка
  let start = 0;
  // Пока остаток работы не помещается в одну катушку
  while (used(steps) - used(start) > spoolM - KNOT_TAILS_M) {
    // Сколько лески будет израсходовано, когда текущая катушка кончится
    const limit = used(start) + spoolM - KNOT_TAILS_M;
    // Ищем последний шаг, который ещё помещается
    let end = start;
    // Двигаемся, пока следующий шаг влезает
    while (end + 1 <= steps && used(end + 1) <= limit) end++;
    // Не влезает даже одна нить
    if (end === start) break; // катушка короче одной нити — планировать нечего
    // Лучший шаг для узла (по умолчанию — последний возможный)
    let best = end;
    // Смотрим назад в пределах последних 3 % катушки
    for (let i = end; i > start && used(end) - used(i) <= spoolM * WINDOW_SHARE; i--) {
      // Гвоздь с бо́льшим числом нитей — узел спрячется лучше
      if (usage[sequence[i]] > usage[sequence[best]]) best = i;
    }
    // Записываем смену
    changes.push({
      // Номер заканчивающейся катушки
      spool: changes.length + 1,
      // После какого шага
      afterStep: best,
      // На каком гвозде
      nail: sequence[best],
      // Метка гвоздя
      label: nailLabel(sequence[best]),
      // Сколько лески уйдёт к этому моменту (до 10 см)
      usedM: Math.round(used(best) * 10) / 10,
    });
    // Новая катушка начинается с этого шага
    start = best;
  }
  // Смены и сколько катушек всего
  return { changes, spools: changes.length + 1 };
}

/** Ближайшая смена катушки впереди (или null). */
// Следующая смена относительно текущего шага
export function nextChange(changes: readonly SpoolChange[], step: number): SpoolChange | null {
  // Первая смена, которая ещё не пройдена
  return changes.find((c) => c.afterStep >= step) ?? null;
}
