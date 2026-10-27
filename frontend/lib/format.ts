const nf = (digits: number) =>
  new Intl.NumberFormat("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** 1176.7 → «1 176,7» (неразрывные пробелы между разрядами). */
export function num(value: number, digits = 0): string {
  return nf(digits).format(value);
}

export function seconds(value: number): string {
  return `${num(value, 1)} с`;
}

export function date(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

/** Русское множественное число: plural(5, ["шаг", "шага", "шагов"]) → «шагов». */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b === 1) return forms[0];
  if (b >= 2 && b <= 4) return forms[1];
  return forms[2];
}
