// Уменьшаем фото в браузере перед загрузкой: 12-мегапиксельный снимок → ~300 КБ JPEG.
// Алгоритму всё равно нужно 400×400, а загрузка через мобильный интернет станет мгновенной.
// Наибольшая сторона после уменьшения (так же хранит сервер)
export const MAX_UPLOAD_SIDE = 1600;

// Размер после уменьшения с сохранением пропорций (увеличения нет)
export function scaledSize(w: number, h: number, max = MAX_UPLOAD_SIDE): [number, number] {
  // Коэффициент: не больше 1 (маленькие фото не растягиваем)
  const k = Math.min(1, max / Math.max(w, h));
  // Новые ширина и высота, округлённые до пикселя
  return [Math.round(w * k), Math.round(h * k)];
}

// Уменьшить фото перед загрузкой; при любой проблеме вернуть исходный файл
export async function downscaleImage(file: File): Promise<Blob> {
  // Старый браузер без createImageBitmap — отправляем как есть
  if (typeof createImageBitmap !== "function") return file;
  // Декодирование может не получиться
  try {
    // Декодируем фото с учётом поворота из EXIF (снимок с телефона «на боку»)
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    // Новый размер
    const [w, h] = scaledSize(bitmap.width, bitmap.height);
    // Холст для перерисовки
    const canvas = document.createElement("canvas");
    // Ширина холста
    canvas.width = w;
    // Высота холста
    canvas.height = h;
    // Контекст рисования
    const ctx = canvas.getContext("2d");
    // Нет контекста (например, в тестах) — отправляем исходник
    if (!ctx) return file;
    // Белая заливка
    ctx.fillStyle = "#fff"; // прозрачный PNG → белый фон, как на бэкенде
    // Заливаем весь холст
    ctx.fillRect(0, 0, w, h);
    // Рисуем фото уменьшенным
    ctx.drawImage(bitmap, 0, 0, w, h);
    // Освобождаем память декодированного фото
    bitmap.close();
    // Получаем JPEG качества 90 % (toBlob асинхронный — оборачиваем в Promise)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    // Если не получилось — исходник
    return blob ?? file;
    // Ошибка декодирования
  } catch {
    // Отправляем исходник
    return file; // формат, который браузер не умеет декодировать, — пусть решает сервер
  }
}
