// Видео-таймлапс «как натягиваются нити» и открытка с портретом — всё рисуется в браузере.
// Число гвоздей
import { TOTAL_NAILS } from "./constants";
// Прозрачность нити — как на превью
import { lineAlpha } from "./draw";
// Числа по-русски
import { num } from "./format";
// Координаты гвоздей
import { nailXY } from "./nails";

// Цвет нитей
const INK = "#000000";
// Цвет доски
const BOARD = "#ffffff";
// Фон: верх градиента
const BG_TOP = "#1b2029";
// Фон: низ градиента
const BG_BOTTOM = "#0c0f14";

/** Видео в формате, который понимает браузер: mp4 (лучше для мессенджеров) или webm. */
// Выбор формата записи видео
export function videoFormat(): { mime: string; ext: "mp4" | "webm" } | null {
  // Браузер не умеет записывать видео
  if (typeof MediaRecorder === "undefined") return null;
  // Перебираем форматы от лучшего к запасным
  for (const [mime, ext] of [
    // MP4 с кодеком H.264 — открывается везде (Telegram, WhatsApp, iPhone)
    ["video/mp4;codecs=avc1.42E01E", "mp4"],
    // MP4 без указания кодека
    ["video/mp4", "mp4"],
    // WebM VP9
    ["video/webm;codecs=vp9", "webm"],
    // WebM VP8
    ["video/webm;codecs=vp8", "webm"],
    // Любой WebM
    ["video/webm", "webm"],
    // as const — TypeScript знает точные значения ext ("mp4" | "webm")
  ] as const) {
    // Первый поддерживаемый
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  // Ничего не подошло
  return null;
}

/** Сколько линий показать к кадру frame из frames: сначала медленно, потом быстрее, в конце снова медленно. */
// Число нитей на кадре с плавным разгоном и торможением
export function linesAtFrame(frame: number, frames: number, lines: number): number {
  // Доля прошедшего времени 0..1
  const t = Math.min(1, Math.max(0, frame / Math.max(1, frames)));
  // Кривая «ease-in-out» (квадратичная): медленно — быстро — медленно
  const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  // Целое число нитей
  return Math.round(lines * eased);
}

// Холст с картиной, на котором копятся нити
interface Art {
  // Холст
  canvas: HTMLCanvasElement;
  // Контекст рисования
  ctx: CanvasRenderingContext2D;
  // Координаты гвоздей
  pts: [number, number][];
  // Сколько нитей уже нарисовано
  drawn: number;
}

/** Холст с круглой доской, на который нити дорисовываются по одной (как в жизни). */
// Создать холст картины
function createArt(size: number, diameterCm: number): Art {
  // Новый холст
  const canvas = document.createElement("canvas");
  // Квадрат size × size
  canvas.width = canvas.height = size;
  // Контекст (! — уверены, что он есть: 2D-контекст в браузере всегда доступен)
  const ctx = canvas.getContext("2d")!;
  // Радиус доски с маленьким отступом
  const r = size / 2 - size * 0.01;
  // Белый
  ctx.fillStyle = BOARD;
  // Новая фигура
  ctx.beginPath();
  // Круг доски
  ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
  // Залить
  ctx.fill();
  // Цвет нитей
  ctx.strokeStyle = INK;
  // Прозрачность нити под размер холста и диаметр доски
  ctx.globalAlpha = lineAlpha(2 * r, diameterCm);
  // Толщина
  ctx.lineWidth = Math.max(1, size / 1400);
  // Холст, контекст, гвозди и счётчик
  return { canvas, ctx, pts: Array.from({ length: TOTAL_NAILS }, (_, i) => nailXY(i, r, size / 2, size / 2)), drawn: 0 };
}

// Дорисовать нити до нужного числа (уже нарисованные не трогаем — быстро)
function drawUpTo(art: Art, sequence: readonly number[], lines: number) {
  // От уже нарисованных до нужного числа
  for (; art.drawn < lines && art.drawn + 1 < sequence.length; art.drawn++) {
    // Откуда
    const [x0, y0] = art.pts[sequence[art.drawn]];
    // Куда
    const [x1, y1] = art.pts[sequence[art.drawn + 1]];
    // Новая фигура
    art.ctx.beginPath();
    // Начало
    art.ctx.moveTo(x0, y0);
    // Конец
    art.ctx.lineTo(x1, y1);
    // Провести
    art.ctx.stroke();
  }
}

// Дождаться загрузки шрифтов (иначе на первом кадре будет системный шрифт)
async function fontsReady() {
  // Загрузка может не удаться
  try {
    // Оба шрифта приложения
    await Promise.all([document.fonts.load("700 48px Unbounded"), document.fonts.load("400 24px 'Golos Text'")]);
    // Не загрузились
  } catch {
    /* системный шрифт тоже подойдёт */
  }
}

// Тёмный градиентный фон
function background(ctx: CanvasRenderingContext2D, w: number, h: number) {
  // Вертикальный градиент
  const g = ctx.createLinearGradient(0, 0, 0, h);
  // Верх
  g.addColorStop(0, BG_TOP);
  // Низ
  g.addColorStop(1, BG_BOTTOM);
  // Использовать градиент как заливку
  ctx.fillStyle = g;
  // Залить всё
  ctx.fillRect(0, 0, w, h);
}

// Параметры таймлапса
export interface TimelapseOptions {
  // Последовательность гвоздей
  sequence: readonly number[];
  // Сколько нитей
  lines: number;
  // Диаметр
  diameterCm: number;
  // Название в конце ролика
  title: string;
  // Длина ролика, с
  seconds: number;
  // Размер кадра (по умолчанию 1080)
  size?: number;
  // Прогресс записи 0..1
  onProgress?: (share: number) => void;
  // Сигнал отмены
  signal?: AbortSignal;
}

/**
 * Видео 1080×1080: нити натягиваются одна за другой, внизу — счётчик, в конце — название.
 * Запись идёт в реальном времени (сколько секунд ролик, столько и пишется).
 */
// Записать таймлапс
export async function recordTimelapse(o: TimelapseOptions): Promise<{ blob: Blob; ext: string }> {
  // Формат видео
  const format = videoFormat();
  // Браузер не умеет — понятная ошибка
  if (!format) throw new Error("Этот браузер не умеет записывать видео. Попробуйте Chrome, Edge или Яндекс Браузер.");
  // Шрифты
  await fontsReady();
  // Размер кадра
  const size = o.size ?? 1080;
  // Кадров в секунду
  const fps = 30;
  // Готовая картина держится 2 секунды
  const holdFrames = fps * 2;
  // Кадров на натяжение нитей
  const frames = Math.round(o.seconds * fps);
  // Холст кадра видео
  const out = document.createElement("canvas");
  // Квадрат
  out.width = out.height = size;
  // Контекст
  const ctx = out.getContext("2d")!;
  // Доска — 78 % кадра
  const boardSize = Math.round(size * 0.78);
  // Холст картины
  const art = createArt(boardSize, o.diameterCm);
  // Доска по центру по горизонтали
  const bx = (size - boardSize) / 2;
  // И с отступом сверху (снизу — место под текст)
  const by = size * 0.06;

  // Видеопоток с холста
  const stream = out.captureStream(fps);
  // Запись потока с битрейтом 8 Мбит/с (хорошее качество)
  const recorder = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: 8_000_000 });
  // Куски записанного видео
  const chunks: Blob[] = [];
  // Сохраняем каждый непустой кусок
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  // Обещание «запись остановлена»
  const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));

  // Нарисовать кадр номер frame
  const paint = (frame: number) => {
    // Сколько нитей на этом кадре (после конца — все)
    const target = frame >= frames ? o.lines : linesAtFrame(frame, frames, o.lines);
    // Дорисовываем нити
    drawUpTo(art, o.sequence, target);
    // Фон
    background(ctx, size, size);
    // Запомнить настройки
    ctx.save();
    // Мягкая тень под доской
    ctx.shadowColor = "rgba(0,0,0,.55)";
    // Размытие тени
    ctx.shadowBlur = size / 30;
    // Доска с нитями
    ctx.drawImage(art.canvas, bx, by);
    // Вернуть настройки (тень больше не нужна)
    ctx.restore();
    // Светлый текст
    ctx.fillStyle = "#e9ecf2";
    // По центру
    ctx.textAlign = "center";
    // Пока нити натягиваются
    if (frame < frames) {
      // Шрифт счётчика
      ctx.font = `600 ${Math.round(size / 26)}px 'Golos Text', sans-serif`;
      // «1 200 из 3 000 нитей»
      ctx.fillText(`${num(target)} из ${num(o.lines)} нитей`, size / 2, size * 0.93);
      // Финальные кадры
    } else {
      // Шрифт названия
      ctx.font = `700 ${Math.round(size / 20)}px Unbounded, sans-serif`;
      // Название портрета
      ctx.fillText(o.title, size / 2, size * 0.925);
      // Шрифт подписи
      ctx.font = `400 ${Math.round(size / 36)}px 'Golos Text', sans-serif`;
      // Серее
      ctx.fillStyle = "#aeb6c4";
      // Параметры: нити, диаметр (без «,0» для целых), гвозди
      ctx.fillText(`${num(o.lines)} нитей · ${num(o.diameterCm, o.diameterCm % 1 ? 1 : 0)} см · 240 гвоздей`, size / 2, size * 0.968);
    }
  };

  // Первый кадр до начала записи
  paint(0);
  // Начать запись, отдавая куски каждые 250 мс
  recorder.start(250);
  // Время начала
  const start = performance.now();
  // Все кадры плюс финальная пауза
  for (let frame = 0; frame <= frames + holdFrames; frame++) {
    // Отменили — выходим
    if (o.signal?.aborted) break;
    // Рисуем кадр
    paint(frame);
    // Сообщаем прогресс
    o.onProgress?.(Math.min(1, frame / (frames + holdFrames)));
    // Сколько ждать до следующего кадра (держим ровно 30 кадров в секунду)
    const wait = start + ((frame + 1) * 1000) / fps - performance.now();
    // Ждём
    await new Promise((r) => setTimeout(r, Math.max(0, wait)));
  }
  // Остановить запись
  recorder.stop();
  // Остановить поток
  stream.getTracks().forEach((t) => t.stop());
  // Дождаться последних данных
  await done;
  // Отменили — сообщаем ошибкой «прервано»
  if (o.signal?.aborted) throw new DOMException("Отменено", "AbortError");
  // Склеиваем куски в один файл
  return { blob: new Blob(chunks, { type: format.mime.split(";")[0] }), ext: format.ext };
}

// Параметры открытки
export interface CardOptions {
  // Последовательность
  sequence: readonly number[];
  // Число нитей
  lines: number;
  // Диаметр
  diameterCm: number;
  // Подпись (например, «С днём рождения, мама!»)
  caption: string;
  // Название портрета (если подписи нет)
  title: string;
  // Длина лески, м
  threadM: number;
}

/** Открытка 1080×1350 (формат публикации в соцсетях): портрет, подпись, цифры. */
// Нарисовать открытку и вернуть PNG
export async function renderCard(o: CardOptions): Promise<Blob> {
  // Шрифты
  await fontsReady();
  // Ширина
  const w = 1080;
  // Высота (пропорция 4:5)
  const h = 1350;
  // Холст
  const c = document.createElement("canvas");
  // Ширина холста
  c.width = w;
  // Высота холста
  c.height = h;
  // Контекст
  const ctx = c.getContext("2d")!;
  // Фон
  background(ctx, w, h);
  // тонкие «нити» по краям — как фирменный мотив приложения
  // Запомнить настройки
  ctx.save();
  // Едва заметные белые линии
  ctx.strokeStyle = "rgba(255,255,255,.06)";
  // Тонкие
  ctx.lineWidth = 1;
  // 40 линий
  for (let i = 0; i < 40; i++) {
    // Угол с шагом «золотого угла» 137,5° — линии ложатся равномерно, без узора
    const a = (i * 137.5 * Math.PI) / 180;
    // Новая фигура
    ctx.beginPath();
    // Начало далеко за краем
    ctx.moveTo(w / 2 + Math.cos(a) * w, h * 0.4 + Math.sin(a) * w);
    // Конец — с другой стороны
    ctx.lineTo(w / 2 + Math.cos(a + 2.2) * w, h * 0.4 + Math.sin(a + 2.2) * w);
    // Провести
    ctx.stroke();
  }
  // Вернуть настройки
  ctx.restore();

  // Размер доски на открытке
  const boardSize = 860;
  // Холст картины
  const art = createArt(boardSize, o.diameterCm);
  // Все нити сразу
  drawUpTo(art, o.sequence, o.lines);
  // Запомнить настройки
  ctx.save();
  // Тень
  ctx.shadowColor = "rgba(0,0,0,.6)";
  // Размытие тени
  ctx.shadowBlur = 50;
  // Тень чуть ниже
  ctx.shadowOffsetY = 18;
  // Доска по центру, 90 px от верха
  ctx.drawImage(art.canvas, (w - boardSize) / 2, 90);
  // Вернуть настройки
  ctx.restore();

  // Текст по центру
  ctx.textAlign = "center";
  // Белый
  ctx.fillStyle = "#ffffff";
  // Подпись или название
  const caption = o.caption.trim() || o.title;
  // Начальный размер шрифта
  let fontSize = 64;
  // Шрифт подписи
  ctx.font = `700 ${fontSize}px Unbounded, sans-serif`;
  // Уменьшаем шрифт, пока подпись не влезет в ширину (но не меньше 30 px)
  while (ctx.measureText(caption).width > w - 120 && fontSize > 30) {
    // Меньше на 2 px
    fontSize -= 2;
    // Применить
    ctx.font = `700 ${fontSize}px Unbounded, sans-serif`;
  }
  // Подпись под портретом
  ctx.fillText(caption, w / 2, 1080);
  // Шрифт строки с цифрами
  ctx.font = "400 30px 'Golos Text', sans-serif";
  // Серый
  ctx.fillStyle = "#b6bfcd";
  // Леска: в км, если больше 1000 м
  const km = o.threadM >= 1000 ? `${num(o.threadM / 1000, 1)} км` : `${num(Math.round(o.threadM))} м`;
  // Строка с цифрами
  ctx.fillText(`${num(o.lines)} нитей · ${km} лески · 240 гвоздей · Ø ${num(o.diameterCm, o.diameterCm % 1 ? 1 : 0)} см`, w / 2, 1140);
  // Шрифт подвала
  ctx.font = "400 24px 'Golos Text', sans-serif";
  // Ещё темнее
  ctx.fillStyle = "#7d8696";
  // «Портрет из нитей · октябрь 2026 г.»
  ctx.fillText(`Портрет из нитей · ${new Date().toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}`, w / 2, 1290);
  // PNG; toBlob асинхронный — оборачиваем в Promise
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Не удалось сохранить картинку"))), "image/png"));
}

/** Скачать файл, сделанный в браузере. */
// Сохранить файл на компьютер
export function saveBlob(blob: Blob, filename: string) {
  // Временный адрес файла
  const url = URL.createObjectURL(blob);
  // Невидимая ссылка
  const a = document.createElement("a");
  // Адрес
  a.href = url;
  // Имя файла при сохранении
  a.download = filename;
  // Ссылка должна быть в документе (Firefox)
  document.body.appendChild(a);
  // «Нажимаем» — начинается скачивание
  a.click();
  // Убираем ссылку
  a.remove();
  // Через минуту освобождаем память (сразу нельзя — скачивание могло не начаться)
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
