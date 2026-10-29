// Версия для телефона: размытие по Гауссу тремя проходами «скользящего среднего».
// Три одинаково подобранных прямоугольных размытия почти не отличаются от гауссова,
// но стоят одинаково при любом радиусе — это важно для оценки сходства на телефоне.

/** Ширины трёх прямоугольных окон, дающих размытие с отклонением sigma. */
export function boxesForGauss(sigma: number, n = 3): number[] {
  // «Идеальная» ширина окна
  const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
  // Ближайшая нечётная снизу
  let wl = Math.floor(ideal);
  // Чётную уменьшаем до нечётной
  if (wl % 2 === 0) wl--;
  // Следующая нечётная
  const wu = wl + 2;
  // Сколько окон взять узкими
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  // Ширины окон
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu));
}

// Скользящее среднее вдоль строк (r — полуширина окна); за краем — повтор крайнего пикселя
function boxRows(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  // Делитель — ширина окна
  const k = 1 / (r * 2 + 1);
  // Каждая строка
  for (let y = 0; y < h; y++) {
    // Начало строки
    const row = y * w;
    // Первый пиксель строки
    const first = src[row];
    // Последний
    const last = src[row + w - 1];
    // Сумма окна вокруг x = −1: r+1 копий первого слева и r пикселей справа
    let sum = (r + 1) * first;
    // Правая часть начального окна
    for (let x = 0; x < r; x++) sum += x < w ? src[row + x] : last;
    // Каждый пиксель строки
    for (let x = 0; x < w; x++) {
      // Правый край окна (за строкой — последний пиксель)
      const right = x + r;
      // Левый край, который уходит
      const left = x - r - 1;
      // Сдвигаем окно
      sum += (right < w ? src[row + right] : last) - (left >= 0 ? src[row + left] : first);
      // Среднее
      dst[row + x] = sum * k;
    }
  }
}

// Скользящее среднее вдоль столбцов: все столбцы сразу, строка за строкой (быстро для памяти)
function boxCols(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  // Делитель
  const k = 1 / (r * 2 + 1);
  // Суммы окон по столбцам
  const sum = new Float32Array(w);
  // Начало последней строки
  const lastRow = (h - 1) * w;
  // Начальные окна вокруг y = −1
  for (let x = 0; x < w; x++) {
    // r+1 копий первой строки сверху
    let s = (r + 1) * src[x];
    // r строк снизу
    for (let y = 0; y < r; y++) s += src[(y < h ? y : h - 1) * w + x];
    // Записываем
    sum[x] = s;
  }
  // Каждая строка результата
  for (let y = 0; y < h; y++) {
    // Строка, которая входит снизу
    const inRow = y + r < h ? (y + r) * w : lastRow;
    // Строка, которая уходит сверху
    const outRow = y - r - 1 >= 0 ? (y - r - 1) * w : 0;
    // Начало строки результата
    const row = y * w;
    // Каждый столбец
    for (let x = 0; x < w; x++) {
      // Сдвигаем окно
      sum[x] += src[inRow + x] - src[outRow + x];
      // Среднее
      dst[row + x] = sum[x] * k;
    }
  }
}

/** Размытие по Гауссу с отклонением sigma (в пикселях); исходный массив не меняется. */
export function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  // Слишком маленькое — почти без изменений
  if (sigma < 0.5) return Float32Array.from(src);
  // Ширины окон
  const boxes = boxesForGauss(sigma);
  // Два рабочих буфера
  let a = Float32Array.from(src);
  // Второй
  let b = new Float32Array(src.length);
  // По строкам: три прохода
  for (const size of boxes) {
    // Проход
    boxRows(a, b, w, h, (size - 1) / 2);
    // Меняем буферы местами
    [a, b] = [b, a];
  }
  // По столбцам: три прохода
  for (const size of boxes) {
    // Проход
    boxCols(a, b, w, h, (size - 1) / 2);
    // Меняем местами
    [a, b] = [b, a];
  }
  // Результат — в a после последней перестановки
  return a;
}
