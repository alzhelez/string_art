// Геометрия гвоздей — зеркало backend/app/geometry.py.
// Сектора A,B,C,D — четверти круга по осям X/Y, по часовой стрелке от левой точки оси X:
// A — слева сверху, B — справа сверху, C — справа снизу, D — слева снизу.
// Константы гвоздей
import { NAILS_PER_SECTOR, SECTORS, TOTAL_NAILS } from "./constants";

// Угол между соседними гвоздями (1,5°)
export const ANGLE_STEP = (2 * Math.PI) / TOTAL_NAILS;
/** Сектор A начинается в левой точке оси X: −90° от верхней точки по часовой. */
// Начальный угол отсчёта
export const START_ANGLE = -Math.PI / 2;

// Проверка номера гвоздя
function check(index: number): void {
  // Не целое или вне 0..239
  if (!Number.isInteger(index) || index < 0 || index >= TOTAL_NAILS) {
    // Ошибка «вне диапазона» с полученным значением
    throw new RangeError(`Индекс гвоздя должен быть 0..${TOTAL_NAILS - 1}, получено ${index}`);
  }
}

/** Угол в радианах, по часовой стрелке от верхней точки (A1 ≈ −90°). */
// Угол гвоздя
export function nailAngle(index: number): number {
  // Проверяем номер
  check(index);
  // +0,5 — гвоздь сдвинут на полшага от оси
  return START_ANGLE + (index + 0.5) * ANGLE_STEP;
}

/** Середина сектора (0 — A … 3 — D): где рисовать крупную букву. */
// Угол середины сектора
export function sectorCenterAngle(sector: number): number {
  // Сектор — четверть круга
  return START_ANGLE + (sector + 0.5) * (Math.PI / 2);
}

// Буква сектора гвоздя
export function nailSector(index: number): (typeof SECTORS)[number] {
  // Проверяем номер
  check(index);
  // Номер сектора = целая часть от деления на 60
  return SECTORS[Math.floor(index / NAILS_PER_SECTOR)];
}

// Номер гвоздя внутри сектора (1..60)
export function nailNumber(index: number): number {
  // Проверяем номер
  check(index);
  // Остаток от деления + 1
  return (index % NAILS_PER_SECTOR) + 1;
}

/** 0 → "A1", 239 → "D60" */
// Метка гвоздя
export function nailLabel(index: number): string {
  // Буква + номер
  return `${nailSector(index)}${nailNumber(index)}`;
}

// Шаблон метки: буква A–D, необязательный дефис, 1–2 цифры
const LABEL_RE = /^\s*([A-Da-d])\s*-?\s*(\d{1,2})\s*$/;

// Метка → номер гвоздя (для поля «перейти к гвоздю»)
export function parseLabel(label: string): number {
  // Проверяем шаблоном
  const m = LABEL_RE.exec(label);
  // Не похоже на метку
  if (!m) throw new Error(`Некорректная метка гвоздя: ${label}`);
  // Номер сектора по букве (регистр не важен)
  const sector = SECTORS.indexOf(m[1].toUpperCase() as (typeof SECTORS)[number]);
  // Номер в секторе
  const n = Number(m[2]);
  // Должен быть 1..60
  if (n < 1 || n > NAILS_PER_SECTOR) throw new Error(`Номер гвоздя должен быть 1..${NAILS_PER_SECTOR}`);
  // Сквозной номер
  return sector * NAILS_PER_SECTOR + n - 1;
}

/** Экранные координаты (ось Y вниз). */
// Координаты гвоздя на экране
export function nailXY(index: number, radius: number, cx = 0, cy = 0): [number, number] {
  // Угол
  const a = nailAngle(index);
  // x = центр + r·sin, y = центр − r·cos (Y вниз)
  return [cx + radius * Math.sin(a), cy - radius * Math.cos(a)];
}

// Расстояние между гвоздями по кругу (короткий путь)
export function nailGap(a: number, b: number): number {
  // Разница номеров по модулю 240
  const diff = Math.abs(a - b) % TOTAL_NAILS;
  // Короче в одну или в другую сторону
  return Math.min(diff, TOTAL_NAILS - diff);
}

// Длина нити между гвоздями
export function chordLength(a: number, b: number, diameter: number): number {
  // Хорда = d · sin(угол / 2)
  return diameter * Math.sin((nailGap(a, b) * ANGLE_STEP) / 2);
}

// Расстояние между соседними гвоздями по дуге
export function arcSpacing(diameter: number): number {
  // Длина окружности / число гвоздей
  return (Math.PI * diameter) / TOTAL_NAILS;
}
