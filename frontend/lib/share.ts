// Видео-таймлапс «как натягиваются нити» и открытка с портретом — всё рисуется в браузере.
import { TOTAL_NAILS } from "./constants";
import { lineAlpha } from "./draw";
import { num } from "./format";
import { nailXY } from "./nails";

const INK = "#000000";
const BOARD = "#ffffff";
const BG_TOP = "#1b2029";
const BG_BOTTOM = "#0c0f14";

/** Видео в формате, который понимает браузер: mp4 (лучше для мессенджеров) или webm. */
export function videoFormat(): { mime: string; ext: "mp4" | "webm" } | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const [mime, ext] of [
    ["video/mp4;codecs=avc1.42E01E", "mp4"],
    ["video/mp4", "mp4"],
    ["video/webm;codecs=vp9", "webm"],
    ["video/webm;codecs=vp8", "webm"],
    ["video/webm", "webm"],
  ] as const) {
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return null;
}

/** Сколько линий показать к кадру frame из frames: сначала медленно, потом быстрее, в конце снова медленно. */
export function linesAtFrame(frame: number, frames: number, lines: number): number {
  const t = Math.min(1, Math.max(0, frame / Math.max(1, frames)));
  const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  return Math.round(lines * eased);
}

interface Art {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  pts: [number, number][];
  drawn: number;
}

/** Холст с круглой доской, на который нити дорисовываются по одной (как в жизни). */
function createArt(size: number, diameterCm: number): Art {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const r = size / 2 - size * 0.01;
  ctx.fillStyle = BOARD;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.globalAlpha = lineAlpha(2 * r, diameterCm);
  ctx.lineWidth = Math.max(1, size / 1400);
  return { canvas, ctx, pts: Array.from({ length: TOTAL_NAILS }, (_, i) => nailXY(i, r, size / 2, size / 2)), drawn: 0 };
}

function drawUpTo(art: Art, sequence: readonly number[], lines: number) {
  for (; art.drawn < lines && art.drawn + 1 < sequence.length; art.drawn++) {
    const [x0, y0] = art.pts[sequence[art.drawn]];
    const [x1, y1] = art.pts[sequence[art.drawn + 1]];
    art.ctx.beginPath();
    art.ctx.moveTo(x0, y0);
    art.ctx.lineTo(x1, y1);
    art.ctx.stroke();
  }
}

async function fontsReady() {
  try {
    await Promise.all([document.fonts.load("700 48px Unbounded"), document.fonts.load("400 24px 'Golos Text'")]);
  } catch {
    /* системный шрифт тоже подойдёт */
  }
}

function background(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, BG_TOP);
  g.addColorStop(1, BG_BOTTOM);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

export interface TimelapseOptions {
  sequence: readonly number[];
  lines: number;
  diameterCm: number;
  title: string;
  seconds: number;
  size?: number;
  onProgress?: (share: number) => void;
  signal?: AbortSignal;
}

/**
 * Видео 1080×1080: нити натягиваются одна за другой, внизу — счётчик, в конце — название.
 * Запись идёт в реальном времени (сколько секунд ролик, столько и пишется).
 */
export async function recordTimelapse(o: TimelapseOptions): Promise<{ blob: Blob; ext: string }> {
  const format = videoFormat();
  if (!format) throw new Error("Этот браузер не умеет записывать видео. Попробуйте Chrome, Edge или Яндекс Браузер.");
  await fontsReady();
  const size = o.size ?? 1080;
  const fps = 30;
  const holdFrames = fps * 2;
  const frames = Math.round(o.seconds * fps);
  const out = document.createElement("canvas");
  out.width = out.height = size;
  const ctx = out.getContext("2d")!;
  const boardSize = Math.round(size * 0.78);
  const art = createArt(boardSize, o.diameterCm);
  const bx = (size - boardSize) / 2;
  const by = size * 0.06;

  const stream = out.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));

  const paint = (frame: number) => {
    const target = frame >= frames ? o.lines : linesAtFrame(frame, frames, o.lines);
    drawUpTo(art, o.sequence, target);
    background(ctx, size, size);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.55)";
    ctx.shadowBlur = size / 30;
    ctx.drawImage(art.canvas, bx, by);
    ctx.restore();
    ctx.fillStyle = "#e9ecf2";
    ctx.textAlign = "center";
    if (frame < frames) {
      ctx.font = `600 ${Math.round(size / 26)}px 'Golos Text', sans-serif`;
      ctx.fillText(`${num(target)} из ${num(o.lines)} нитей`, size / 2, size * 0.93);
    } else {
      ctx.font = `700 ${Math.round(size / 20)}px Unbounded, sans-serif`;
      ctx.fillText(o.title, size / 2, size * 0.925);
      ctx.font = `400 ${Math.round(size / 36)}px 'Golos Text', sans-serif`;
      ctx.fillStyle = "#aeb6c4";
      ctx.fillText(`${num(o.lines)} нитей · ${num(o.diameterCm, o.diameterCm % 1 ? 1 : 0)} см · 240 гвоздей`, size / 2, size * 0.968);
    }
  };

  paint(0);
  recorder.start(250);
  const start = performance.now();
  for (let frame = 0; frame <= frames + holdFrames; frame++) {
    if (o.signal?.aborted) break;
    paint(frame);
    o.onProgress?.(Math.min(1, frame / (frames + holdFrames)));
    const wait = start + ((frame + 1) * 1000) / fps - performance.now();
    await new Promise((r) => setTimeout(r, Math.max(0, wait)));
  }
  recorder.stop();
  stream.getTracks().forEach((t) => t.stop());
  await done;
  if (o.signal?.aborted) throw new DOMException("Отменено", "AbortError");
  return { blob: new Blob(chunks, { type: format.mime.split(";")[0] }), ext: format.ext };
}

export interface CardOptions {
  sequence: readonly number[];
  lines: number;
  diameterCm: number;
  caption: string;
  title: string;
  threadM: number;
}

/** Открытка 1080×1350 (формат публикации в соцсетях): портрет, подпись, цифры. */
export async function renderCard(o: CardOptions): Promise<Blob> {
  await fontsReady();
  const w = 1080;
  const h = 1350;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  background(ctx, w, h);
  // тонкие «нити» по краям — как фирменный мотив приложения
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,.06)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 40; i++) {
    const a = (i * 137.5 * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(w / 2 + Math.cos(a) * w, h * 0.4 + Math.sin(a) * w);
    ctx.lineTo(w / 2 + Math.cos(a + 2.2) * w, h * 0.4 + Math.sin(a + 2.2) * w);
    ctx.stroke();
  }
  ctx.restore();

  const boardSize = 860;
  const art = createArt(boardSize, o.diameterCm);
  drawUpTo(art, o.sequence, o.lines);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.6)";
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 18;
  ctx.drawImage(art.canvas, (w - boardSize) / 2, 90);
  ctx.restore();

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  const caption = o.caption.trim() || o.title;
  let fontSize = 64;
  ctx.font = `700 ${fontSize}px Unbounded, sans-serif`;
  while (ctx.measureText(caption).width > w - 120 && fontSize > 30) {
    fontSize -= 2;
    ctx.font = `700 ${fontSize}px Unbounded, sans-serif`;
  }
  ctx.fillText(caption, w / 2, 1080);
  ctx.font = "400 30px 'Golos Text', sans-serif";
  ctx.fillStyle = "#b6bfcd";
  const km = o.threadM >= 1000 ? `${num(o.threadM / 1000, 1)} км` : `${num(Math.round(o.threadM))} м`;
  ctx.fillText(`${num(o.lines)} нитей · ${km} лески · 240 гвоздей · Ø ${num(o.diameterCm, o.diameterCm % 1 ? 1 : 0)} см`, w / 2, 1140);
  ctx.font = "400 24px 'Golos Text', sans-serif";
  ctx.fillStyle = "#7d8696";
  ctx.fillText(`Портрет из нитей · ${new Date().toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}`, w / 2, 1290);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Не удалось сохранить картинку"))), "image/png"));
}

/** Скачать файл, сделанный в браузере. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
