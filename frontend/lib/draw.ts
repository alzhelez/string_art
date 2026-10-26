// Отрисовка картины на canvas. Модель смешивания совпадает с backend/app/render.py:
// каждая линия умножает яркость пикселя на (1 − alpha), alpha = толщина лески / размер пикселя.
import { SECTORS, THREAD_DIAMETER_MM, TOTAL_NAILS } from "./constants";
import { nailLabel, nailXY, sectorCenterAngle } from "./nails";
import { PALETTE } from "./palette";

export function lineAlpha(pixelSize: number, diameterCm: number): number {
  const pixelMm = (diameterCm * 10) / pixelSize;
  return Math.min(1, Math.max(0.02, THREAD_DIAMETER_MM / pixelMm));
}

// Текущие цвета (подписи и акцент берутся из темы оформления). Белый круг и чёрная леска — всегда такие.
let P: typeof PALETTE = PALETTE;

export interface DrawOptions {
  /** Цвета темы: подписи гвоздей, оси, акцент текущей линии. */
  colors?: Partial<Pick<typeof PALETTE, "graphite" | "steel" | "chalk">>;
  sequence: readonly number[];
  /** Сколько линий рисовать (префикс последовательности). */
  lines: number;
  diameterCm: number;
  /** Размер холста в физических пикселях. */
  size: number;
  /** Режим плетения: подсветить шаг (1-based) и показать оси/сектора. */
  activeStep?: number;
  /** Насколько бледно рисовать уже натянутые линии в режиме плетения (0..1). */
  doneOpacity?: number;
}

export function boardGeometry(size: number, withLabels: boolean) {
  const pad = withLabels ? size * 0.075 : size * 0.02;
  return { cx: size / 2, cy: size / 2, r: size / 2 - pad };
}

export function drawBoard(ctx: CanvasRenderingContext2D, o: DrawOptions): void {
  P = { ...PALETTE };
  for (const [k, v] of Object.entries(o.colors ?? {})) if (v) (P as Record<string, string>)[k] = v;
  const weave = o.activeStep !== undefined;
  const { size } = o;
  const { cx, cy, r } = boardGeometry(size, weave);
  ctx.clearRect(0, 0, size, size);

  ctx.fillStyle = P.board;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  const lines = weave ? Math.max(0, (o.activeStep ?? 1) - 1) : o.lines;
  const alpha = lineAlpha(2 * r, o.diameterCm) * (weave ? (o.doneOpacity ?? 0.45) : 1);
  ctx.strokeStyle = P.line;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = Math.max(1, size / 1400);
  const pts = Array.from({ length: TOTAL_NAILS }, (_, i) => nailXY(i, r, cx, cy));
  for (let i = 0; i < lines && i + 1 < o.sequence.length; i++) {
    const [x0, y0] = pts[o.sequence[i]];
    const [x1, y1] = pts[o.sequence[i + 1]];
    ctx.beginPath(); // отдельный stroke на линию — иначе пересечения не темнеют
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  if (weave) drawAxes(ctx, cx, cy, r, size);

  const dot = Math.max(1, size / 650);
  ctx.fillStyle = P.steel;
  for (const [x, y] of pts) {
    ctx.beginPath();
    ctx.arc(x, y, dot, 0, Math.PI * 2);
    ctx.fill();
  }

  if (weave) {
    const step = o.activeStep ?? 1;
    const from = o.sequence[step - 1];
    const to = o.sequence[step];
    if (from === undefined || to === undefined) return;
    const [x0, y0] = pts[from];
    const [x1, y1] = pts[to];
    ctx.strokeStyle = P.chalk;
    ctx.lineWidth = Math.max(2, size / 260);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    marker(ctx, x0, y0, nailLabel(from), cx, cy, size, false);
    marker(ctx, x1, y1, nailLabel(to), cx, cy, size, true);
  }
}

function drawAxes(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, size: number) {
  ctx.save();
  ctx.strokeStyle = P.steel;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = Math.max(1, size / 900);
  ctx.setLineDash([size / 120, size / 120]);
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();
  ctx.restore();

  // Буквы секторов — крупно внутри круга, чтобы не спорить с подписями гвоздей снаружи.
  ctx.save();
  ctx.fillStyle = P.steel;
  ctx.globalAlpha = 0.28;
  ctx.font = `700 ${Math.round(size / 9)}px Unbounded, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const rr = r * 0.55;
  SECTORS.forEach((s, i) => {
    const a = sectorCenterAngle(i);
    ctx.fillText(s, cx + rr * Math.sin(a), cy - rr * Math.cos(a));
  });
  ctx.restore();
}

function marker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  cx: number,
  cy: number,
  size: number,
  target: boolean,
) {
  const rad = size / (target ? 70 : 110);
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  ctx.fillStyle = target ? P.chalk : P.board;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, size / 400);
  ctx.strokeStyle = P.chalk;
  ctx.stroke();
  // подпись снаружи круга
  const dx = x - cx;
  const dy = y - cy;
  const len = Math.hypot(dx, dy) || 1;
  const off = size / 26;
  ctx.font = `600 ${Math.round(size / (target ? 34 : 42))}px Unbounded, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = target ? P.chalk : P.graphite;
  ctx.fillText(label, x + (dx / len) * off, y + (dy / len) * off);
}
