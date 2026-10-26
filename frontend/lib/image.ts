// Уменьшаем фото в браузере перед загрузкой: 12-мегапиксельный снимок → ~300 КБ JPEG.
// Алгоритму всё равно нужно 400×400, а загрузка через мобильный интернет станет мгновенной.
export const MAX_UPLOAD_SIDE = 1600;

export function scaledSize(w: number, h: number, max = MAX_UPLOAD_SIDE): [number, number] {
  const k = Math.min(1, max / Math.max(w, h));
  return [Math.round(w * k), Math.round(h * k)];
}

export async function downscaleImage(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const [w, h] = scaledSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff"; // прозрачный PNG → белый фон, как на бэкенде
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    return blob ?? file;
  } catch {
    return file; // формат, который браузер не умеет декодировать, — пусть решает сервер
  }
}
