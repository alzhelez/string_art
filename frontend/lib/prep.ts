// Подготовка фото в браузере — зеркало backend/app/photo.py.
// Редактор показывает ровно то, что получит алгоритм: кадр 400×400 в оттенках серого.
// Совпадение формул проверяет эталон autotests/fixtures/prep-golden.json (pytest и Vitest).

// Размер подготовленного кадра (как PROCESSING_SIZE на бэкенде)
export const PREP_SIZE = 400;
// Автоуровни отсекают по 1 % пикселей с каждого края гистограммы
export const AUTO_LEVELS_CUTOFF = 0.01;

// Настройки подготовки фото
export interface Prep {
  // Центр кадра по горизонтали (доля ширины)
  center_x: number;
  // Центр по вертикали
  center_y: number;
  // Масштаб 1…4
  zoom: number;
  // Яркость −0,5…0,5
  brightness: number;
  // Контраст −0,5…1
  contrast: number;
  // Убрать фон
  remove_background: boolean;
  // Выделить лицо
  face_focus: boolean;
}

// Настройки по умолчанию: весь центр, без изменений
export const DEFAULT_PREP: Prep = {
  // Центр по горизонтали
  center_x: 0.5,
  // Центр по вертикали
  center_y: 0.5,
  // Без увеличения
  zoom: 1,
  // Без изменения яркости
  brightness: 0,
  // Без изменения контраста
  contrast: 0,
  // Фон не убирать
  remove_background: false,
  // Лицо не выделять
  face_focus: false,
};

// Пределы ползунков (те же, что проверяет API)
export const PREP_LIMITS = {
  // Масштаб
  zoom: [1, 4],
  // Яркость
  brightness: [-0.5, 0.5],
  // Контраст
  contrast: [-0.5, 1],
} as const;

// Ограничить число пределами
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Привести все настройки к допустимым значениям
export function clampPrep(p: Prep): Prep {
  // Копия с ограниченными полями
  return {
    // Остальные поля без изменений
    ...p,
    // Центр в пределах фото
    center_x: clamp(p.center_x, 0, 1),
    // По вертикали тоже
    center_y: clamp(p.center_y, 0, 1),
    // Масштаб 1…4 (...массив — пределы как два аргумента)
    zoom: clamp(p.zoom, ...PREP_LIMITS.zoom),
    // Яркость
    brightness: clamp(p.brightness, ...PREP_LIMITS.brightness),
    // Контраст
    contrast: clamp(p.contrast, ...PREP_LIMITS.contrast),
  };
}

/** Кадр в пикселях оригинала: [x0, y0, side]. Не выходит за края фото. */
// Где квадрат кадра на оригинале
export function cropBox(width: number, height: number, p: Prep): [number, number, number] {
  // Сторона: короткая сторона фото / масштаб
  const side = Math.min(width, height) / Math.max(1, p.zoom);
  // Левый край, не выходя за фото
  const x0 = clamp(p.center_x * width - side / 2, 0, width - side);
  // Верхний край
  const y0 = clamp(p.center_y * height - side / 2, 0, height - side);
  // Результат
  return [x0, y0, side];
}

/**
 * Привязывает центр к допустимой области: после зума или сдвига центр не может
 * «уехать» туда, где кадр упирается в край фото, — иначе перетаскивание залипает.
 */
// Пересчитать центр по фактическому положению кадра
export function normalizeCenter(width: number, height: number, p: Prep): Prep {
  // Фактический кадр (уже прижатый к краям)
  const [x0, y0, side] = cropBox(width, height, p);
  // Центр — середина фактического кадра
  return { ...p, center_x: (x0 + side / 2) / width, center_y: (y0 + side / 2) / height };
}

/** Сдвиг кадра на dx, dy пикселей экрана при ширине окна viewportPx. */
// Перетаскивание фото мышью/пальцем
export function pan(width: number, height: number, p: Prep, dx: number, dy: number, viewportPx: number): Prep {
  // Сторона кадра на оригинале
  const [, , side] = cropBox(width, height, p);
  // Сколько пикселей фото приходится на пиксель экрана
  const k = side / viewportPx; // пикселей оригинала на пиксель экрана
  // Сдвигаем центр в обратную сторону (тянем фото вправо — кадр уходит влево) и нормализуем
  return normalizeCenter(width, height, {
    // Остальные настройки
    ...p,
    // Новый центр по горизонтали
    center_x: p.center_x - (dx * k) / width,
    // По вертикали
    center_y: p.center_y - (dy * k) / height,
  });
}

// --- тональные операции ------------------------------------------------------
// Пиксели RGBA → яркость (как на бэкенде)
export function toGray(rgba: Uint8ClampedArray | number[]): Float32Array {
  // По одному числу на пиксель (в RGBA — четыре)
  const out = new Float32Array(rgba.length / 4);
  // i — позиция в RGBA, j — номер пикселя
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    // Формула яркости ITU-R 601
    out[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  }
  // Готово
  return out;
}

/** mask 0..255: 255 — объект, 0 — фон (станет белым). */
// Фон → белый
export function applyMask(gray: Float32Array, mask: ArrayLike<number>): Float32Array {
  // Результат
  const out = new Float32Array(gray.length);
  // Каждый пиксель
  for (let i = 0; i < gray.length; i++) {
    // Доля «человека» 0..1
    const a = mask[i] / 255;
    // Смешивание с белым
    out[i] = gray[i] * a + 255 * (1 - a);
  }
  // Готово
  return out;
}

// numpy.rint — округление к чётному на .5; повторяем, чтобы гистограммы совпадали с бэкендом.
// Банковское округление
function rint(v: number): number {
  // Целая часть
  const f = Math.floor(v);
  // Дробная часть
  const d = v - f;
  // Больше половины — вверх
  if (d > 0.5) return f + 1;
  // Меньше — вниз
  if (d < 0.5) return f;
  // Ровно половина — к чётному
  return f % 2 === 0 ? f : f + 1;
}

// Автоуровни (как на бэкенде)
export function autoLevels(gray: Float32Array, cutoff = AUTO_LEVELS_CUTOFF): Float32Array {
  // Гистограмма 256 значений
  const hist = new Float64Array(256);
  // Считаем пиксели каждой яркости
  for (const v of gray) hist[clamp(rint(v), 0, 255)]++;
  // Всего пикселей
  const total = gray.length;
  // Порог снизу (1 %)
  const lowTarget = total * cutoff;
  // Порог сверху (99 %)
  const highTarget = total * (1 - cutoff);
  // numpy.searchsorted(cum, x, side="right") / side="left"
  // Накопленная сумма
  let cum = 0;
  // Нижняя граница (256 — ещё не найдена)
  let lo = 256;
  // Верхняя граница
  let hi = 256;
  // Проходим по гистограмме
  for (let i = 0; i < 256; i++) {
    // Копим
    cum += hist[i];
    // Первая яркость, где накоплено больше 1 %
    if (lo === 256 && cum > lowTarget) lo = i;
    // Первая яркость, где накоплено ≥ 99 %
    if (hi === 256 && cum >= highTarget) hi = i;
  }
  // Однотонная картинка — без изменений
  if (hi <= lo) return Float32Array.from(gray);
  // Коэффициент растяжения
  const k = 255 / (hi - lo);
  // Растягиваем и обрезаем
  return gray.map((v) => clamp((v - lo) * k, 0, 255));
}

// Яркость и контраст (как на бэкенде)
export function brightnessContrast(gray: Float32Array, brightness: number, contrast: number): Float32Array {
  // Контраст от середины 128, яркость — сдвиг
  return gray.map((v) => clamp((v - 128) * (1 + contrast) + 128 + brightness * 255, 0, 255));
}

/** Тональная часть конвейера: серое → (фон) → автоуровни → яркость/контраст. */
// Тональная обработка целиком
export function processGray(gray: Float32Array, p: Prep, mask?: ArrayLike<number> | null): Uint8ClampedArray {
  // Убрать фон, если включено и маска есть
  let g = p.remove_background && mask ? applyMask(gray, mask) : gray;
  // Автоуровни
  g = autoLevels(g);
  // Яркость и контраст
  g = brightnessContrast(g, p.brightness, p.contrast);
  // Округление как в numpy и перевод в 8-битные значения
  return Uint8ClampedArray.from(g, (v) => rint(v));
}

// --- отрисовка в canvas -------------------------------------------------------
// Источник картинки для canvas с известными размерами (img, canvas, bitmap)
type Source = CanvasImageSource & { width: number; height: number };

// Вырезать кадр и получить пиксели size×size
function cropToPixels(src: Source, p: Prep, size: number, srcW: number, srcH: number): Uint8ClampedArray | null {
  // Временный холст
  const c = document.createElement("canvas");
  // Ширина
  c.width = size;
  // Высота
  c.height = size;
  // willReadFrequently — подсказка браузеру: будем читать пиксели (быстрее getImageData)
  const ctx = c.getContext("2d", { willReadFrequently: true });
  // Нет canvas (тесты) — null
  if (!ctx) return null;
  // Кадр считается в координатах оригинала; маска может быть другого размера — масштабируем.
  // Масштаб источника относительно оригинала
  const k = src.width / srcW;
  // Кадр в координатах источника
  const [x0, y0, side] = cropBox(srcW, srcH, p).map((v) => v * k);
  // Сглаживание при уменьшении
  ctx.imageSmoothingEnabled = true;
  // Высокое качество сглаживания
  ctx.imageSmoothingQuality = "high";
  // Белый фон
  ctx.fillStyle = "#fff";
  // Заливка
  ctx.fillRect(0, 0, size, size);
  // Рисуем кадр, растянутый на весь холст
  ctx.drawImage(src, x0, y0, side, side, 0, 0, size, size);
  // Пиксели RGBA
  return ctx.getImageData(0, 0, size, size).data;
}

/** Рисует подготовленный кадр в canvas. Возвращает false, если canvas недоступен (тесты). */
// Показать в редакторе то, что увидит алгоритм
export function drawPrepared(
  // Холст на странице
  target: HTMLCanvasElement,
  // Оригинал фото
  image: Source,
  // Маска фона (или null)
  mask: Source | null,
  // Настройки
  p: Prep,
  // Размер
  size = PREP_SIZE,
  // showRemoved — режим кисти: показывать убранный фон розовым
  opts: { showRemoved?: boolean } = {},
// Возвращает успех
): boolean {
  // Пиксели кадра
  const rgba = cropToPixels(image, p, size, image.width, image.height);
  // Нет canvas
  if (!rgba) return false;
  // Пиксели маски (по одному числу на пиксель)
  let maskPx: Uint8Array | null = null;
  // Маска нужна
  if (mask && p.remove_background) {
    // Вырезаем тем же кадром
    const m = cropToPixels(mask, p, size, image.width, image.height);
    // Получилось
    if (m) {
      // Массив яркостей маски
      maskPx = new Uint8Array(size * size);
      // Берём красный канал (маска серая — каналы равны)
      for (let i = 0; i < maskPx.length; i++) maskPx[i] = m[i * 4];
    }
  }
  // Яркость
  const gray = toGray(rgba);
  // Тональная обработка
  const out = processGray(gray, p, maskPx);
  // Контекст целевого холста
  const ctx = target.getContext("2d");
  // Нет — неудача
  if (!ctx) return false;
  // Размер холста
  target.width = size;
  // Высота
  target.height = size;
  // Буфер пикселей
  const img = ctx.createImageData(size, size);
  // Серое → RGBA
  for (let i = 0; i < out.length; i++) {
    // R = G = B = яркость
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = out[i];
    // Непрозрачный
    img.data[i * 4 + 3] = 255;
  }
  // Режим кисти
  if (opts.showRemoved && maskPx) {
    // Режим кисти: убранный фон виден бледно-розовым — понятно, что можно вернуть.
    // Каждый пиксель
    for (let i = 0; i < out.length; i++) {
      // Доля человека
      const a = maskPx[i] / 255;
      // Человек — без изменений
      if (a > 0.99) continue;
      // Светлый тон с сохранением рисунка фото
      const t = 150 + gray[i] * 0.4;
      // Красный канал
      img.data[i * 4] = Math.round(out[i] * a + t * (1 - a));
      // Зелёный — меньше
      img.data[i * 4 + 1] = Math.round(out[i] * a + t * 0.72 * (1 - a));
      // Синий
      img.data[i * 4 + 2] = Math.round(out[i] * a + t * 0.8 * (1 - a));
    }
  }
  // Выводим на холст
  ctx.putImageData(img, 0, 0);
  // Успех
  return true;
}
