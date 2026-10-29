// Версия для телефона: картинка готовой картины (как backend/app/render.py) — пиксели RGBA.
// Каждая линия умножает яркость пикселя на (1 − α); вокруг круга — белое поле,
// по кругу — тонкий контур и точки гвоздей.

// Число гвоздей
import { TOTAL_NAILS } from "../constants";
// Координаты гвоздя
import { nailXY } from "../nails";
// Счётчики нитей
import { lineCounts } from "./algorithm";
// Цвет тройкой
import type { RGB } from "./colors";
// Непрозрачность линии и таблица пропускания света
import { keepTable, lineAlpha } from "./similarity";

/** Слой для рисования: схема, сколько линий, цвет нити. */
export interface RenderLayer {
  // Схема
  sequence: readonly number[];
  // Сколько линий
  steps: number;
  // Цвет 0..1
  rgb: RGB;
}

/** Картина size×size в RGBA: слои по порядку поверх доски, контур и гвозди. */
export function renderLayers(layers: RenderLayer[], size: number, diameterCm: number, board: RGB, nails = true): Uint8ClampedArray {
  // Пропускание света
  const keep = keepTable(lineAlpha(size, diameterCm));
  // Последний индекс таблицы
  const top = keep.length - 1;
  // Холст в долях 0..1
  const canvas = new Float32Array(size * size * 3);
  // Заливаем доской
  for (let p = 0; p < size * size; p++) canvas.set(board, p * 3);
  // Каждый слой
  for (const layer of layers) {
    // Счётчики нитей
    const counts = lineCounts(layer.sequence, layer.steps, size);
    // Цвет
    const [r, g, b] = layer.rgb;
    // Каждая точка
    for (let p = 0; p < counts.length; p++) {
      // Без нитей — пропускаем
      if (counts[p] === 0) continue;
      // Пропущенный свет
      const t = keep[counts[p] < top ? counts[p] : top];
      // Красный
      canvas[p * 3] = canvas[p * 3] * t + r * (1 - t);
      // Зелёный
      canvas[p * 3 + 1] = canvas[p * 3 + 1] * t + g * (1 - t);
      // Синий
      canvas[p * 3 + 2] = canvas[p * 3 + 2] * t + b * (1 - t);
    }
  }
  // Пиксели RGBA
  const out = new Uint8ClampedArray(size * size * 4);
  // Радиус круга гвоздей
  const radius = size / 2 - 0.5;
  // Центр
  const c = (size - 1) / 2;
  // Толщина контура
  const ring = Math.max(1, Math.floor(size / 400));
  // Каждая строка
  for (let y = 0; y < size; y++) {
    // Каждый столбец
    for (let x = 0; x < size; x++) {
      // Номер точки
      const p = y * size + x;
      // Расстояние до центра
      const dist = Math.hypot(x - c, y - c);
      // Снаружи круга (с запасом 2 px) — белое поле
      const outside = dist > radius + 2;
      // На контуре
      const onRing = !outside && Math.abs(dist - radius) <= ring / 2 + 0.5;
      // Цвет: белое, серый контур или картина
      for (let ch = 0; ch < 3; ch++) out[p * 4 + ch] = outside ? 255 : onRing ? 200 : Math.round(canvas[p * 3 + ch] * 255);
      // Непрозрачно
      out[p * 4 + 3] = 255;
    }
  }
  // Гвозди — серые точки
  if (nails) {
    // Радиус точки
    const dot = Math.max(1, size / 500);
    // Каждый гвоздь
    for (let i = 0; i < TOTAL_NAILS; i++) {
      // Центр точки
      const [nx, ny] = nailXY(i, radius, c, c);
      // Квадрат вокруг точки
      for (let y = Math.floor(ny - dot); y <= Math.ceil(ny + dot); y++) {
        // Столбцы
        for (let x = Math.floor(nx - dot); x <= Math.ceil(nx + dot); x++) {
          // За краем или вне кружка — пропускаем
          if (x < 0 || y < 0 || x >= size || y >= size || Math.hypot(x - nx, y - ny) > dot) continue;
          // Серый
          out.fill(150, (y * size + x) * 4, (y * size + x) * 4 + 3);
        }
      }
    }
  }
  // Картинка
  return out;
}
