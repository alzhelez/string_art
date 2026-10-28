// Зеркало backend/app/config.py. Совпадение проверяет контрактный тест (e2e/api.contract.spec.ts).

// Буквы секторов; as const — TypeScript знает, что это ровно "A" | "B" | "C" | "D"
export const SECTORS = ["A", "B", "C", "D"] as const;
// Тип «буква сектора», выведенный из массива
export type Sector = (typeof SECTORS)[number];
// Гвоздей в секторе
export const NAILS_PER_SECTOR = 60;
// Всего гвоздей
export const TOTAL_NAILS = NAILS_PER_SECTOR * SECTORS.length; // 240

// Минимум линий на ползунке
export const MIN_LINES = 1000;
// Максимум линий (столько считает алгоритм)
export const MAX_LINES = 5000;
// Минимум линий одной нити цветного портрета (маленькое цветное пятно — немного линий)
export const LAYER_MIN_LINES = 100;
// Ориентир: линий на сантиметр диаметра
export const LINES_PER_CM = 40;

// Кнопки быстрого выбора диаметра
export const DIAMETER_PRESETS_CM = [30, 40, 50, 60, 70] as const;
// Диаметр по умолчанию
export const DEFAULT_DIAMETER_CM = 50;
// Наименьший диаметр
export const MIN_DIAMETER_CM = 20;
// Наибольший диаметр
export const MAX_DIAMETER_CM = 150;

// Толщина лески, мм
export const THREAD_DIAMETER_MM = 0.2;
// Запас лески 15 %
export const THREAD_MARGIN = 0.15;
// Стандартные катушки, м
export const STANDARD_SPOOLS_M = [100, 150, 200, 300, 500, 1000, 1500, 2000, 3000, 5000] as const;
// Большая катушка, если не хватает стандартных
export const BIG_SPOOL_M = 1000;

// Скорость автоперелистывания по умолчанию, с
export const DEFAULT_SPEED_SEC = 2.0;
// Шаг изменения скорости
export const SPEED_STEP_SEC = 0.1;
// Самая быстрая
export const MIN_SPEED_SEC = 0.5;
// Самая медленная
export const MAX_SPEED_SEC = 10.0;
