// Подготовка фото в браузере — зеркало backend/app/photo.py.
// Редактор показывает ровно то, что получит алгоритм: кадр 400×400 в оттенках серого.
// Совпадение формул проверяет эталон autotests/fixtures/prep-golden.json (pytest и Vitest).

export const PREP_SIZE = 400;
export const AUTO_LEVELS_CUTOFF = 0.01;

export interface Prep {
  center_x: number;
  center_y: number;
  zoom: number;
  brightness: number;
  contrast: number;
  remove_background: boolean;
  face_focus: boolean;
}

export const DEFAULT_PREP: Prep = {
  center_x: 0.5,
  center_y: 0.5,
  zoom: 1,
  brightness: 0,
  contrast: 0,
  remove_background: false,
  face_focus: false,
};

export const PREP_LIMITS = {
  zoom: [1, 4],
  brightness: [-0.5, 0.5],
  contrast: [-0.5, 1],
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function clampPrep(p: Prep): Prep {
  return {
    ...p,
    center_x: clamp(p.center_x, 0, 1),
    center_y: clamp(p.center_y, 0, 1),
    zoom: clamp(p.zoom, ...PREP_LIMITS.zoom),
    brightness: clamp(p.brightness, ...PREP_LIMITS.brightness),
    contrast: clamp(p.contrast, ...PREP_LIMITS.contrast),
  };
}

/** Кадр в пикселях оригинала: [x0, y0, side]. Не выходит за края фото. */
export function cropBox(width: number, height: number, p: Prep): [number, number, number] {
  const side = Math.min(width, height) / Math.max(1, p.zoom);
  const x0 = clamp(p.center_x * width - side / 2, 0, width - side);
  const y0 = clamp(p.center_y * height - side / 2, 0, height - side);
  return [x0, y0, side];
}

/**
 * Привязывает центр к допустимой области: после зума или сдвига центр не может
 * «уехать» туда, где кадр упирается в край фото, — иначе перетаскивание залипает.
 */
export function normalizeCenter(width: number, height: number, p: Prep): Prep {
  const [x0, y0, side] = cropBox(width, height, p);
  return { ...p, center_x: (x0 + side / 2) / width, center_y: (y0 + side / 2) / height };
}

/** Сдвиг кадра на dx, dy пикселей экрана при ширине окна viewportPx. */
export function pan(width: number, height: number, p: Prep, dx: number, dy: number, viewportPx: number): Prep {
  const [, , side] = cropBox(width, height, p);
  const k = side / viewportPx; // пикселей оригинала на пиксель экрана
  return normalizeCenter(width, height, {
    ...p,
    center_x: p.center_x - (dx * k) / width,
    center_y: p.center_y - (dy * k) / height,
  });
}

// --- тональные операции ------------------------------------------------------
export function toGray(rgba: Uint8ClampedArray | number[]): Float32Array {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  }
  return out;
}

/** mask 0..255: 255 — объект, 0 — фон (станет белым). */
export function applyMask(gray: Float32Array, mask: ArrayLike<number>): Float32Array {
  const out = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    const a = mask[i] / 255;
    out[i] = gray[i] * a + 255 * (1 - a);
  }
  return out;
}

// numpy.rint — округление к чётному на .5; повторяем, чтобы гистограммы совпадали с бэкендом.
function rint(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

export function autoLevels(gray: Float32Array, cutoff = AUTO_LEVELS_CUTOFF): Float32Array {
  const hist = new Float64Array(256);
  for (const v of gray) hist[clamp(rint(v), 0, 255)]++;
  const total = gray.length;
  const lowTarget = total * cutoff;
  const highTarget = total * (1 - cutoff);
  // numpy.searchsorted(cum, x, side="right") / side="left"
  let cum = 0;
  let lo = 256;
  let hi = 256;
  for (let i = 0; i < 256; i++) {
    cum += hist[i];
    if (lo === 256 && cum > lowTarget) lo = i;
    if (hi === 256 && cum >= highTarget) hi = i;
  }
  if (hi <= lo) return Float32Array.from(gray);
  const k = 255 / (hi - lo);
  return gray.map((v) => clamp((v - lo) * k, 0, 255));
}

export function brightnessContrast(gray: Float32Array, brightness: number, contrast: number): Float32Array {
  return gray.map((v) => clamp((v - 128) * (1 + contrast) + 128 + brightness * 255, 0, 255));
}

/** Тональная часть конвейера: серое → (фон) → автоуровни → яркость/контраст. */
export function processGray(gray: Float32Array, p: Prep, mask?: ArrayLike<number> | null): Uint8ClampedArray {
  let g = p.remove_background && mask ? applyMask(gray, mask) : gray;
  g = autoLevels(g);
  g = brightnessContrast(g, p.brightness, p.contrast);
  return Uint8ClampedArray.from(g, (v) => rint(v));
}

// --- отрисовка в canvas -------------------------------------------------------
type Source = CanvasImageSource & { width: number; height: number };

function cropToPixels(src: Source, p: Prep, size: number, srcW: number, srcH: number): Uint8ClampedArray | null {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  // Кадр считается в координатах оригинала; маска может быть другого размера — масштабируем.
  const k = src.width / srcW;
  const [x0, y0, side] = cropBox(srcW, srcH, p).map((v) => v * k);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(src, x0, y0, side, side, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

/** Рисует подготовленный кадр в canvas. Возвращает false, если canvas недоступен (тесты). */
export function drawPrepared(
  target: HTMLCanvasElement,
  image: Source,
  mask: Source | null,
  p: Prep,
  size = PREP_SIZE,
): boolean {
  const rgba = cropToPixels(image, p, size, image.width, image.height);
  if (!rgba) return false;
  let maskPx: Uint8Array | null = null;
  if (mask && p.remove_background) {
    const m = cropToPixels(mask, p, size, image.width, image.height);
    if (m) {
      maskPx = new Uint8Array(size * size);
      for (let i = 0; i < maskPx.length; i++) maskPx[i] = m[i * 4];
    }
  }
  const out = processGray(toGray(rgba), p, maskPx);
  const ctx = target.getContext("2d");
  if (!ctx) return false;
  target.width = size;
  target.height = size;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < out.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = out[i];
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return true;
}
