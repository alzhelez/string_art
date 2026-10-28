// Форматировщик чисел по-русски с заданным числом знаков после запятой
const nf = (digits: number) =>
  // Intl.NumberFormat ставит неразрывные пробелы между разрядами и запятую
  new Intl.NumberFormat("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** 1176.7 → «1 176,7» (неразрывные пробелы между разрядами). */
// Число по-русски
export function num(value: number, digits = 0): string {
  // Форматируем
  return nf(digits).format(value);
}

// Секунды с одним знаком: «2,0 с»
export function seconds(value: number): string {
  // Число + единица
  return `${num(value, 1)} с`;
}

// Дата из ISO-строки: «27 октября 2026 г.»
export function date(iso: string): string {
  // Русская дата с названием месяца
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

/** Русское множественное число: plural(5, ["шаг", "шага", "шагов"]) → «шагов». */
// Выбор формы слова по числу
export function plural(n: number, forms: [string, string, string]): string {
  // Последние две цифры (минус не важен)
  const a = Math.abs(n) % 100;
  // Последняя цифра
  const b = a % 10;
  // 11–19 — всегда «шагов»
  if (a > 10 && a < 20) return forms[2];
  // 1, 21, 31… — «шаг»
  if (b === 1) return forms[0];
  // 2–4, 22–24… — «шага»
  if (b >= 2 && b <= 4) return forms[1];
  // Остальное — «шагов»
  return forms[2];
}
