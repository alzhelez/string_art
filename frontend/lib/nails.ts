// Геометрия гвоздей — зеркало backend/app/geometry.py.
// Сектора A,B,C,D — четверти круга по осям X/Y, по часовой стрелке от левой точки оси X:
// A — слева сверху, B — справа сверху, C — справа снизу, D — слева снизу.
import { NAILS_PER_SECTOR, SECTORS, TOTAL_NAILS } from "./constants";

export const ANGLE_STEP = (2 * Math.PI) / TOTAL_NAILS;
/** Сектор A начинается в левой точке оси X: −90° от верхней точки по часовой. */
export const START_ANGLE = -Math.PI / 2;

function check(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= TOTAL_NAILS) {
    throw new RangeError(`Индекс гвоздя должен быть 0..${TOTAL_NAILS - 1}, получено ${index}`);
  }
}

/** Угол в радианах, по часовой стрелке от верхней точки (A1 ≈ −90°). */
export function nailAngle(index: number): number {
  check(index);
  return START_ANGLE + (index + 0.5) * ANGLE_STEP;
}

/** Середина сектора (0 — A … 3 — D): где рисовать крупную букву. */
export function sectorCenterAngle(sector: number): number {
  return START_ANGLE + (sector + 0.5) * (Math.PI / 2);
}

export function nailSector(index: number): (typeof SECTORS)[number] {
  check(index);
  return SECTORS[Math.floor(index / NAILS_PER_SECTOR)];
}

export function nailNumber(index: number): number {
  check(index);
  return (index % NAILS_PER_SECTOR) + 1;
}

/** 0 → "A1", 239 → "D60" */
export function nailLabel(index: number): string {
  return `${nailSector(index)}${nailNumber(index)}`;
}

const LABEL_RE = /^\s*([A-Da-d])\s*-?\s*(\d{1,2})\s*$/;

export function parseLabel(label: string): number {
  const m = LABEL_RE.exec(label);
  if (!m) throw new Error(`Некорректная метка гвоздя: ${label}`);
  const sector = SECTORS.indexOf(m[1].toUpperCase() as (typeof SECTORS)[number]);
  const n = Number(m[2]);
  if (n < 1 || n > NAILS_PER_SECTOR) throw new Error(`Номер гвоздя должен быть 1..${NAILS_PER_SECTOR}`);
  return sector * NAILS_PER_SECTOR + n - 1;
}

/** Экранные координаты (ось Y вниз). */
export function nailXY(index: number, radius: number, cx = 0, cy = 0): [number, number] {
  const a = nailAngle(index);
  return [cx + radius * Math.sin(a), cy - radius * Math.cos(a)];
}

export function nailGap(a: number, b: number): number {
  const diff = Math.abs(a - b) % TOTAL_NAILS;
  return Math.min(diff, TOTAL_NAILS - diff);
}

export function chordLength(a: number, b: number, diameter: number): number {
  return diameter * Math.sin((nailGap(a, b) * ANGLE_STEP) / 2);
}

export function arcSpacing(diameter: number): number {
  return (Math.PI * diameter) / TOTAL_NAILS;
}
