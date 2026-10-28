// Отрисовка картины на canvas. Модель смешивания совпадает с backend/app/render.py:
// каждая линия умножает яркость пикселя на (1 − alpha), alpha = толщина лески / размер пикселя.
// Константы: буквы секторов, толщина лески, число гвоздей
import { SECTORS, THREAD_DIAMETER_MM, TOTAL_NAILS } from "./constants";
// Метка и координаты гвоздя, угол середины сектора
import { nailLabel, nailXY, sectorCenterAngle } from "./nails";
// Цвета по умолчанию
import { PALETTE } from "./palette";

// Непрозрачность одной нити при данном размере картинки (как на бэкенде)
export function lineAlpha(pixelSize: number, diameterCm: number): number {
  // Сколько миллиметров доски в одном пикселе
  const pixelMm = (diameterCm * 10) / pixelSize;
  // Доля пикселя, которую закрывает леска; 2 %…100 %
  return Math.min(1, Math.max(0.02, THREAD_DIAMETER_MM / pixelMm));
}

// Текущие цвета (подписи и акцент берутся из темы оформления). Белый круг и чёрная леска — всегда такие.
// Палитра для текущей отрисовки
let P: typeof PALETTE = PALETTE;

// Параметры отрисовки
export interface DrawOptions {
  /** Цвета темы: подписи гвоздей, оси, акцент текущей линии. */
  colors?: Partial<Pick<typeof PALETTE, "graphite" | "steel" | "chalk">>;
  // Последовательность гвоздей
  sequence: readonly number[];
  /** Сколько линий рисовать (префикс последовательности). */
  lines: number;
  // Диаметр доски (влияет на прозрачность нити)
  diameterCm: number;
  /** Размер холста в физических пикселях. */
  size: number;
  /** Режим плетения: подсветить шаг (1-based) и показать оси/сектора. */
  activeStep?: number;
  /** Насколько бледно рисовать уже натянутые линии в режиме плетения (0..1). */
  doneOpacity?: number;
}

// Центр и радиус круга на холсте (с подписями нужен отступ побольше)
export function boardGeometry(size: number, withLabels: boolean) {
  // Отступ от края: 7,5 % под подписи или 2 %
  const pad = withLabels ? size * 0.075 : size * 0.02;
  // Центр и радиус
  return { cx: size / 2, cy: size / 2, r: size / 2 - pad };
}

// Нарисовать доску с нитями
export function drawBoard(ctx: CanvasRenderingContext2D, o: DrawOptions): void {
  // Начинаем с цветов по умолчанию
  P = { ...PALETTE };
  // Подставляем цвета темы, если переданы
  for (const [k, v] of Object.entries(o.colors ?? {})) if (v) (P as Record<string, string>)[k] = v;
  // Режим плетения — если указан текущий шаг
  const weave = o.activeStep !== undefined;
  // Размер холста
  const { size } = o;
  // Геометрия круга
  const { cx, cy, r } = boardGeometry(size, weave);
  // Очищаем холст
  ctx.clearRect(0, 0, size, size);

  // Белая доска
  ctx.fillStyle = P.board;
  // Начинаем фигуру
  ctx.beginPath();
  // Круг
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  // Заливаем
  ctx.fill();

  // Сколько линий рисовать: в плетении — все до текущего шага, иначе — заданное число
  const lines = weave ? Math.max(0, (o.activeStep ?? 1) - 1) : o.lines;
  // Прозрачность нити; в плетении натянутые нити бледнее, чтобы выделялась текущая
  const alpha = lineAlpha(2 * r, o.diameterCm) * (weave ? (o.doneOpacity ?? 0.45) : 1);
  // Цвет нитей
  ctx.strokeStyle = P.line;
  // Прозрачность
  ctx.globalAlpha = alpha;
  // Толщина линии — не меньше 1 px
  ctx.lineWidth = Math.max(1, size / 1400);
  // Координаты всех гвоздей заранее
  const pts = Array.from({ length: TOTAL_NAILS }, (_, i) => nailXY(i, r, cx, cy));
  // Каждая линия
  for (let i = 0; i < lines && i + 1 < o.sequence.length; i++) {
    // Откуда
    const [x0, y0] = pts[o.sequence[i]];
    // Куда
    const [x1, y1] = pts[o.sequence[i + 1]];
    // Новая фигура для каждой линии
    ctx.beginPath(); // отдельный stroke на линию — иначе пересечения не темнеют
    // Начало
    ctx.moveTo(x0, y0);
    // Конец
    ctx.lineTo(x1, y1);
    // Провести
    ctx.stroke();
  }
  // Прозрачность обратно
  ctx.globalAlpha = 1;

  // В плетении — оси и буквы секторов
  if (weave) drawAxes(ctx, cx, cy, r, size);

  // Радиус точки гвоздя
  const dot = Math.max(1, size / 650);
  // Цвет гвоздей
  ctx.fillStyle = P.steel;
  // Все гвозди
  for (const [x, y] of pts) {
    // Новая фигура
    ctx.beginPath();
    // Кружок
    ctx.arc(x, y, dot, 0, Math.PI * 2);
    // Залить
    ctx.fill();
  }

  // В плетении — выделить текущий шаг
  if (weave) {
    // Номер шага
    const step = o.activeStep ?? 1;
    // Откуда
    const from = o.sequence[step - 1];
    // Куда
    const to = o.sequence[step];
    // За пределами последовательности — ничего не выделяем
    if (from === undefined || to === undefined) return;
    // Координаты начала
    const [x0, y0] = pts[from];
    // Координаты конца
    const [x1, y1] = pts[to];
    // Синий цвет
    ctx.strokeStyle = P.chalk;
    // Толстая линия
    ctx.lineWidth = Math.max(2, size / 260);
    // Скруглённые концы
    ctx.lineCap = "round";
    // Новая фигура
    ctx.beginPath();
    // Начало
    ctx.moveTo(x0, y0);
    // Конец
    ctx.lineTo(x1, y1);
    // Провести
    ctx.stroke();
    // Метка «откуда» — пустой кружок
    marker(ctx, x0, y0, nailLabel(from), cx, cy, size, false);
    // Метка «куда» — залитый кружок, крупнее
    marker(ctx, x1, y1, nailLabel(to), cx, cy, size, true);
  }
}

// Оси и буквы секторов
function drawAxes(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, size: number) {
  // Запомнить настройки рисования
  ctx.save();
  // Цвет осей
  ctx.strokeStyle = P.steel;
  // Полупрозрачные
  ctx.globalAlpha = 0.5;
  // Тонкие
  ctx.lineWidth = Math.max(1, size / 900);
  // Пунктир
  ctx.setLineDash([size / 120, size / 120]);
  // Новая фигура
  ctx.beginPath();
  // Ось X: слева
  ctx.moveTo(cx - r, cy);
  // направо
  ctx.lineTo(cx + r, cy);
  // Ось Y: сверху
  ctx.moveTo(cx, cy - r);
  // вниз
  ctx.lineTo(cx, cy + r);
  // Провести
  ctx.stroke();
  // Вернуть настройки
  ctx.restore();

  // Буквы секторов — крупно внутри круга, чтобы не спорить с подписями гвоздей снаружи.
  // Запомнить настройки
  ctx.save();
  // Цвет букв
  ctx.fillStyle = P.steel;
  // Едва заметные
  ctx.globalAlpha = 0.28;
  // Крупный жирный шрифт заголовков
  ctx.font = `700 ${Math.round(size / 9)}px Unbounded, sans-serif`;
  // Выравнивание по центру
  ctx.textAlign = "center";
  // И по вертикали
  ctx.textBaseline = "middle";
  // На полпути от центра к краю
  const rr = r * 0.55;
  // Каждая буква
  SECTORS.forEach((s, i) => {
    // Угол середины сектора
    const a = sectorCenterAngle(i);
    // Написать букву
    ctx.fillText(s, cx + rr * Math.sin(a), cy - rr * Math.cos(a));
  });
  // Вернуть настройки
  ctx.restore();
}

// Кружок на гвозде и его подпись снаружи круга
function marker(
  // Контекст
  ctx: CanvasRenderingContext2D,
  // Координата X гвоздя
  x: number,
  // Координата Y
  y: number,
  // Подпись
  label: string,
  // Центр круга X
  cx: number,
  // Центр круга Y
  cy: number,
  // Размер холста
  size: number,
  // Целевой гвоздь (куда тянуть)
  target: boolean,
  // Тело функции
) {
  // Радиус кружка: целевой крупнее
  const rad = size / (target ? 70 : 110);
  // Новая фигура
  ctx.beginPath();
  // Кружок
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  // Целевой — синий, исходный — белый
  ctx.fillStyle = target ? P.chalk : P.board;
  // Залить
  ctx.fill();
  // Толщина обводки
  ctx.lineWidth = Math.max(1.5, size / 400);
  // Синяя обводка
  ctx.strokeStyle = P.chalk;
  // Обвести
  ctx.stroke();
  // подпись снаружи круга
  // Направление от центра к гвоздю
  const dx = x - cx;
  // По Y
  const dy = y - cy;
  // Длина направления (|| 1 — защита от деления на ноль)
  const len = Math.hypot(dx, dy) || 1;
  // Отступ подписи от гвоздя
  const off = size / 26;
  // Шрифт подписи: целевая крупнее
  ctx.font = `600 ${Math.round(size / (target ? 34 : 42))}px Unbounded, sans-serif`;
  // По центру
  ctx.textAlign = "center";
  // По вертикали
  ctx.textBaseline = "middle";
  // Целевая — синяя, исходная — тёмно-серая
  ctx.fillStyle = target ? P.chalk : P.graphite;
  // Подпись дальше от центра на off пикселей
  ctx.fillText(label, x + (dx / len) * off, y + (dy / len) * off);
}
