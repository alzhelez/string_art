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
