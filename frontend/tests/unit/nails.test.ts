// Описание тестов и проверки
import { describe, expect, it } from "vitest";
// Общее число гвоздей — 240
import { TOTAL_NAILS } from "@/lib/constants";
// Функции гвоздей: метки, координаты, расстояния
import { arcSpacing, chordLength, nailAngle, nailGap, nailLabel, nailXY, parseLabel } from "@/lib/nails";

// Группа: подписи гвоздей
describe("метки гвоздей", () => {
  // Таблица: номер ↔ подпись на границах секторов
  it.each([
    // Первый гвоздь
    [0, "A1"],
    // Последний в секторе A
    [59, "A60"],
    // Первый в B
    [60, "B1"],
    // Последний в B
    [119, "B60"],
    // Первый в C
    [120, "C1"],
    // Последний в C
    [179, "C60"],
    // Первый в D
    [180, "D1"],
    // Последний гвоздь
    [239, "D60"],
  // Имя теста
  ])("%i ↔ %s", (index, label) => {
    // Номер превращается в подпись
    expect(nailLabel(index)).toBe(label);
    // И подпись — обратно в номер
    expect(parseLabel(label)).toBe(index);
  });

  // Все подписи разные и обратимы
  it("все 240 меток уникальны и обратимы", () => {
    // Подписи всех 240 гвоздей
    const labels = Array.from({ length: TOTAL_NAILS }, (_, i) => nailLabel(i));
    // Разных подписей 240
    expect(new Set(labels).size).toBe(240);
    // Обратное преобразование даёт 0…239
    expect(labels.map(parseLabel)).toEqual(Array.from({ length: 240 }, (_, i) => i));
  });

  // Неправильные подписи отклоняются
  it.each(["", "A", "E1", "A0", "A61", "1A", "Ж5"])("отклоняет %j", (bad) => {
    // Ждём исключение
    expect(() => parseLabel(bad)).toThrow();
  });

  // Номера вне 0…239 и дробные отклоняются
  it.each([-1, 240, 1.5])("индекс %d вне диапазона", (bad) => {
    // Ждём RangeError
    expect(() => nailLabel(bad)).toThrow(RangeError);
  });
});

// Группа: геометрия
describe("геометрия", () => {
  // Таблица: сектор, первый номер, знаки X и Y
  it.each([
    // A — слева сверху
    ["A", 0, -1, -1],
    // B — справа сверху
    ["B", 60, 1, -1],
    // C — справа снизу
    ["C", 120, 1, 1],
    // D — слева снизу
    ["D", 180, -1, 1],
  // Имя теста
  ])("сектор %s — своя четверть по осям X/Y", (_s, start, sx, sy) => {
    // Все 60 гвоздей сектора
    for (let n = 0; n < 60; n++) {
      // Координаты на круге радиуса 1
      const [x, y] = nailXY(start + n, 1);
      // Знак X правильный
      expect(x * sx).toBeGreaterThan(0);
      // Знак Y правильный
      expect(y * sy).toBeGreaterThan(0);
    }
  });

  // Положение первых гвоздей A и B
  it("A1 — над левой точкой оси X, A60 и B1 — по бокам от верхней точки", () => {
    // Координаты A1
    const [x0, y0] = nailXY(0, 1);
    // Почти крайняя левая точка
    expect(x0).toBeLessThan(-0.99);
    // Чуть выше оси X (ось Y направлена вниз)
    expect(y0).toBeLessThan(0);
    // Но совсем чуть-чуть
    expect(y0).toBeGreaterThan(-0.02);
    // A60 — левее верхней точки
    expect(nailXY(59, 1)[0]).toBeLessThan(0);
    // B1 — правее
    expect(nailXY(60, 1)[0]).toBeGreaterThan(0);
    // И у самого верха
    expect(nailXY(60, 1)[1]).toBeLessThan(-0.99);
  });

  // По часовой стрелке
  it("нумерация идёт по часовой стрелке", () => {
    // Угол каждого следующего гвоздя больше предыдущего
    for (let i = 1; i < TOTAL_NAILS; i++) expect(nailAngle(i)).toBeGreaterThan(nailAngle(i - 1));
  });

  // Одинаковое расстояние между соседями
  it("гвозди равноудалены", () => {
    // Расстояние между гвоздём i и следующим
    const d = (i: number) => {
      // Координаты гвоздя i
      const [x0, y0] = nailXY(i, 100);
      // Координаты следующего (после 239 — снова 0)
      const [x1, y1] = nailXY((i + 1) % TOTAL_NAILS, 100);
      // Длина отрезка
      return Math.hypot(x1 - x0, y1 - y0);
    };
    // Расстояния для всех 240 пар
    const all = Array.from({ length: TOTAL_NAILS }, (_, i) => d(i));
    // Разброс практически нулевой
    expect(Math.max(...all) - Math.min(...all)).toBeLessThan(1e-9);
  });

  // Хорда через центр равна диаметру
  it("хорда между противоположными гвоздями равна диаметру", () => {
    // A1 → C1 на круге 50 см — 50 см
    expect(chordLength(0, 120, 50)).toBeCloseTo(50, 10);
    // A1 и D60 — соседи через начало круга
    expect(nailGap(0, 239)).toBe(1);
  });

  // Шаг по дуге совпадает с расчётом сервера
  it("шаг по дуге для 50 см — 6,54 мм (как на бэкенде)", () => {
    // 500 мм / 240 × π ≈ 6,545 мм
    expect(arcSpacing(500)).toBeCloseTo(6.545, 3);
  });
});
