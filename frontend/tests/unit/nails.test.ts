import { describe, expect, it } from "vitest";
import { TOTAL_NAILS } from "@/lib/constants";
import { arcSpacing, chordLength, nailAngle, nailGap, nailLabel, nailXY, parseLabel } from "@/lib/nails";

describe("метки гвоздей", () => {
  it.each([
    [0, "A1"],
    [59, "A60"],
    [60, "B1"],
    [119, "B60"],
    [120, "C1"],
    [179, "C60"],
    [180, "D1"],
    [239, "D60"],
  ])("%i ↔ %s", (index, label) => {
    expect(nailLabel(index)).toBe(label);
    expect(parseLabel(label)).toBe(index);
  });

  it("все 240 меток уникальны и обратимы", () => {
    const labels = Array.from({ length: TOTAL_NAILS }, (_, i) => nailLabel(i));
    expect(new Set(labels).size).toBe(240);
    expect(labels.map(parseLabel)).toEqual(Array.from({ length: 240 }, (_, i) => i));
  });

  it.each(["", "A", "E1", "A0", "A61", "1A", "Ж5"])("отклоняет %j", (bad) => {
    expect(() => parseLabel(bad)).toThrow();
  });

  it.each([-1, 240, 1.5])("индекс %d вне диапазона", (bad) => {
    expect(() => nailLabel(bad)).toThrow(RangeError);
  });
});

describe("геометрия", () => {
  it.each([
    ["A", 0, -1, -1],
    ["B", 60, 1, -1],
    ["C", 120, 1, 1],
    ["D", 180, -1, 1],
  ])("сектор %s — своя четверть по осям X/Y", (_s, start, sx, sy) => {
    for (let n = 0; n < 60; n++) {
      const [x, y] = nailXY(start + n, 1);
      expect(x * sx).toBeGreaterThan(0);
      expect(y * sy).toBeGreaterThan(0);
    }
  });

  it("A1 — над левой точкой оси X, A60 и B1 — по бокам от верхней точки", () => {
    const [x0, y0] = nailXY(0, 1);
    expect(x0).toBeLessThan(-0.99);
    expect(y0).toBeLessThan(0);
    expect(y0).toBeGreaterThan(-0.02);
    expect(nailXY(59, 1)[0]).toBeLessThan(0);
    expect(nailXY(60, 1)[0]).toBeGreaterThan(0);
    expect(nailXY(60, 1)[1]).toBeLessThan(-0.99);
  });

  it("нумерация идёт по часовой стрелке", () => {
    for (let i = 1; i < TOTAL_NAILS; i++) expect(nailAngle(i)).toBeGreaterThan(nailAngle(i - 1));
  });

  it("гвозди равноудалены", () => {
    const d = (i: number) => {
      const [x0, y0] = nailXY(i, 100);
      const [x1, y1] = nailXY((i + 1) % TOTAL_NAILS, 100);
      return Math.hypot(x1 - x0, y1 - y0);
    };
    const all = Array.from({ length: TOTAL_NAILS }, (_, i) => d(i));
    expect(Math.max(...all) - Math.min(...all)).toBeLessThan(1e-9);
  });

  it("хорда между противоположными гвоздями равна диаметру", () => {
    expect(chordLength(0, 120, 50)).toBeCloseTo(50, 10);
    expect(nailGap(0, 239)).toBe(1);
  });

  it("шаг по дуге для 50 см — 6,54 мм (как на бэкенде)", () => {
    expect(arcSpacing(500)).toBeCloseTo(6.545, 3);
  });
});
