// Версия для телефона: работа с картинками — открыть, вырезать кадр, сохранить в JPEG/PNG.
// В браузере всё делает OffscreenCanvas (работает и в Web Worker); в тестах Node
// подставляется простой «сырой» кодек — сервер от этого не зависит.

// Самая длинная сторона хранимого оригинала, как на бэкенде
export const MAX_ORIGINAL_SIDE = 1600;

/** Открытая картинка: размеры и вырезка квадратного кадра. */
export interface Bitmap {
  // Ширина
  width: number;
  // Высота
  height: number;
  // Квадрат (x0, y0, side) в пикселях картинки → size×size пикселей RGBA
  crop(x0: number, y0: number, side: number, size: number): Uint8ClampedArray;
  // Освободить память
  close(): void;
}

/** Что умеет кодек. */
export interface Codec {
  // Открыть файл картинки (не картинка — ошибка)
  open(bytes: Uint8Array): Promise<Bitmap>;
  // Привести загруженное фото к виду хранения: поворот по EXIF, белый фон, ≤ 1600 px, JPEG
  normalize(bytes: Uint8Array): Promise<{ bytes: Uint8Array; width: number; height: number }>;
  // Пиксели RGBA → PNG
  png(rgba: Uint8ClampedArray, width: number, height: number): Promise<Uint8Array>;
}

/** Файл не похож на картинку. */
export class ImageError extends Error {}

// Блоб → байты
async function bytesOf(blob: Blob): Promise<Uint8Array> {
  // Содержимое
  return new Uint8Array(await blob.arrayBuffer());
}

// Холст нужного размера с белым фоном и качественным сглаживанием
function canvas(width: number, height: number) {
  // Холст вне страницы
  const c = new OffscreenCanvas(width, height);
  // Контекст рисования (будем читать пиксели)
  const ctx = c.getContext("2d", { willReadFrequently: true });
  // Нет 2D — браузер слишком старый
  if (!ctx) throw new ImageError("Браузер не умеет работать с картинками в фоне — обновите его");
  // Качественное уменьшение
  ctx.imageSmoothingEnabled = true;
  // Лучшее качество
  ctx.imageSmoothingQuality = "high";
  // Белый фон (прозрачное станет белым, как на бэкенде)
  ctx.fillStyle = "#fff";
  // Заливка
  ctx.fillRect(0, 0, width, height);
  // Холст и контекст
  return { c, ctx };
}

// Декодировать файл картинки (поворот по EXIF — как на бэкенде)
async function decode(bytes: Uint8Array): Promise<ImageBitmap> {
  // Браузер может не понять файл
  try {
    // Декодируем
    return await createImageBitmap(new Blob([bytes as BlobPart]), { imageOrientation: "from-image" });
    // Не картинка
  } catch {
    // Понятная ошибка
    throw new ImageError("Файл не похож на изображение");
  }
}

/** Кодек браузера (страница или Web Worker): createImageBitmap + OffscreenCanvas. */
export const browserCodec: Codec = {
  // Открыть картинку
  async open(bytes) {
    // Картинка в памяти
    const bmp = await decode(bytes);
    // Открытая картинка
    return {
      // Ширина
      width: bmp.width,
      // Высота
      height: bmp.height,
      // Вырезать кадр
      crop(x0, y0, side, size) {
        // Холст кадра
        const { ctx } = canvas(size, size);
        // Рисуем нужный квадрат с уменьшением
        ctx.drawImage(bmp, x0, y0, side, side, 0, 0, size, size);
        // Пиксели
        return ctx.getImageData(0, 0, size, size).data;
      },
      // Освободить
      close() {
        // Память картинки
        bmp.close();
      },
    };
  },
  // Привести фото к виду хранения
  async normalize(bytes) {
    // Декодируем
    const bmp = await decode(bytes);
    // Во сколько раз уменьшить
    const k = Math.min(1, MAX_ORIGINAL_SIDE / Math.max(bmp.width, bmp.height));
    // Новая ширина
    const width = Math.max(1, Math.round(bmp.width * k));
    // Новая высота
    const height = Math.max(1, Math.round(bmp.height * k));
    // Холст
    const { c, ctx } = canvas(width, height);
    // Рисуем всё фото с уменьшением
    ctx.drawImage(bmp, 0, 0, width, height);
    // Освобождаем
    bmp.close();
    // JPEG 90 %, как на бэкенде
    return { bytes: await bytesOf(await c.convertToBlob({ type: "image/jpeg", quality: 0.9 })), width, height };
  },
  // Пиксели → PNG
  async png(rgba, width, height) {
    // Холст
    const { c, ctx } = canvas(width, height);
    // Кладём пиксели
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    // PNG
    return bytesOf(await c.convertToBlob({ type: "image/png" }));
  },
};

// --- «Сырой» кодек для тестов ---------------------------------------------------------
// Формат: «RAW1», ширина и высота (по 2 байта), затем пиксели RGBA.

/** Упаковать пиксели в «сырой» файл. */
export function rawImage(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  // Файл
  const out = new Uint8Array(8 + rgba.length);
  // Метка формата
  out.set([82, 65, 87, 49], 0);
  // Ширина
  out.set([width >> 8, width & 255, height >> 8, height & 255], 4);
  // Пиксели
  out.set(rgba, 8);
  // Файл
  return out;
}

/** Кодек для тестов: «сырые» картинки, кадр — ближайшим пикселем. */
export const rawCodec: Codec = {
  // Открыть
  async open(bytes) {
    // Метка формата
    if (bytes.length < 8 || String.fromCharCode(...bytes.slice(0, 4)) !== "RAW1") throw new ImageError("Файл не похож на изображение");
    // Ширина
    const width = (bytes[4] << 8) | bytes[5];
    // Высота
    const height = (bytes[6] << 8) | bytes[7];
    // Пиксели
    const px = bytes.slice(8);
    // Размер не сходится
    if (px.length !== width * height * 4) throw new ImageError("Файл не похож на изображение");
    // Открытая картинка
    return {
      // Ширина
      width,
      // Высота
      height,
      // Кадр ближайшим пикселем
      crop(x0, y0, side, size) {
        // Результат
        const out = new Uint8ClampedArray(size * size * 4);
        // Каждая строка
        for (let y = 0; y < size; y++) {
          // Строка источника
          const sy = Math.min(height - 1, Math.floor(y0 + ((y + 0.5) * side) / size));
          // Каждый столбец
          for (let x = 0; x < size; x++) {
            // Столбец источника
            const sx = Math.min(width - 1, Math.floor(x0 + ((x + 0.5) * side) / size));
            // Копируем пиксель
            out.set(px.subarray((sy * width + sx) * 4, (sy * width + sx) * 4 + 4), (y * size + x) * 4);
          }
        }
        // Кадр
        return out;
      },
      // Освобождать нечего
      close() {},
    };
  },
  // Без изменений
  async normalize(bytes) {
    // Открываем (проверка)
    const bmp = await this.open(bytes);
    // Те же байты
    return { bytes, width: bmp.width, height: bmp.height };
  },
  // «PNG» — тот же сырой формат
  async png(rgba, width, height) {
    // Сырой файл
    return rawImage(rgba, width, height);
  },
};
