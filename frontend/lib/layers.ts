// Слои портрета: одна чёрная нить или несколько цветных — общий вид для рисования

// Типы проекта и слоя
import type { Layer, Project, ProjectSummary } from "./api";
// Цвета по умолчанию (чёрная леска, белая доска)
import { PALETTE } from "./palette";

/** Нить для рисования: гвозди, сколько линий показать, цвет. */
export interface DrawLayer {
  // Гвозди по порядку
  sequence: readonly number[];
  // Сколько линий рисовать
  lines: number;
  // Цвет нити #rrggbb
  color: string;
}

// Сколько нитей в портрете (у старых проектов без слоёв — одна)
export function layerCount(p: ProjectSummary): number {
  // Длина списка или 1
  return p.layers?.length || 1;
}

// Цветной ли портрет (больше одной нити)
export function isMultiLayer(p: ProjectSummary): boolean {
  // Больше одного слоя
  return layerCount(p) > 1;
}

// Слои проекта с последовательностями; у одной нити — единственный «чёрный» слой из основных полей
export function projectLayers(p: Project): Layer[] {
  // Сервер отдал слои — берём их
  if (p.layers?.length) return p.layers;
  // Иначе собираем один слой из основных полей
  return [
    // Один слой
    {
      // Номер
      index: 0,
      // Ключ цвета
      color: "black",
      // Ключ (как у Swatch)
      key: "black",
      // Название
      name: "Чёрная",
      // Цвет
      hex: PALETTE.line,
      // Число линий
      line_count: p.line_count,
      // Шаг
      current_step: p.current_step,
      // Леска
      stats: p.stats,
      // Гвозди
      sequence: p.sequence,
    },
  ];
}

// Цвет нити для рисования: у одной нити — чистый чёрный (как раньше), у цветного портрета — цвет из каталога
export function drawColor(p: ProjectSummary, layer: { hex: string }): string {
  // Одна нить — эталонная чёрная леска
  return isMultiLayer(p) ? layer.hex : PALETTE.line;
}

// Все слои для рисования; lines — замена числа линий для отдельных слоёв (ползунок в студии)
export function drawLayers(p: Project, lines: Record<number, number> = {}): DrawLayer[] {
  // Каждый слой в формат рисования
  return projectLayers(p).map((l, i) => ({ sequence: l.sequence, lines: lines[i] ?? l.line_count, color: drawColor(p, l) }));
}

// Цвет доски проекта (белая, если сервер не прислал)
export function boardColor(p: ProjectSummary): string {
  // HEX доски или белый
  return p.board?.hex ?? PALETTE.board;
}

// Подпись нити для людей: «Нить 2 из 3: белая»
export function layerTitle(p: ProjectSummary, index: number): string {
  // Слой
  const layer = p.layers?.[index];
  // Одна нить — без номера
  if (!layer || !isMultiLayer(p)) return "Чёрная нить";
  // Номер и цвет
  return `Нить ${index + 1} из ${layerCount(p)}: ${layer.name.toLowerCase()}`;
}
