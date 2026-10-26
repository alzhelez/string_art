import { describe, expect, it } from "vitest";
import { cumulativeLengthsM, pickSpool, rawLengthM, recommendedLines, spoolText, threadStats } from "@/lib/thread";

// Та же последовательность, что в backend/tests/test_thread.py — результаты обязаны совпадать.
const SEQ = [0, 120, 0, 30];

describe("длина лески", () => {
  it("две хорды через центр на 50 см = 1 м", () => {
    expect(rawLengthM(SEQ, 2, 50)).toBeCloseTo(1.0, 10);
  });

  it("накопленная длина монотонна и сходится с суммой", () => {
    const cum = Array.from(cumulativeLengthsM(SEQ, 50));
    expect(cum[0]).toBe(0);
    expect([...cum].sort((a, b) => a - b)).toEqual(cum);
    expect(cum[3]).toBeCloseTo(rawLengthM(SEQ, 3, 50), 10);
  });

  it("запас по умолчанию 15 %", () => {
    const s = threadStats(SEQ, 2, 50);
    expect(s.margin).toBe(0.15);
    // округление до 0,1 м: 1,15 может стать 1,1 (Python) или 1,2 (JS) — оба допустимы
    expect(Math.abs(s.total_length_m - 1.15)).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  it("steps за пределами последовательности — ошибка", () => {
    expect(() => rawLengthM(SEQ, 4, 50)).toThrow(RangeError);
  });
});

describe("катушка", () => {
  it.each([
    [0, 100, 1],
    [100, 100, 1],
    [100.1, 150, 1],
    [1176.7, 1500, 1],
    [5000, 5000, 1],
    [5000.1, 1000, 6],
    [12345, 1000, 13],
  ])("%f м → %i м × %i", (len, spool, count) => {
    expect(pickSpool(len)).toEqual({ spool, count });
  });

  it("катушки всегда хватает", () => {
    for (let len = 0; len < 20000; len += 37) {
      const { spool, count } = pickSpool(len);
      expect(spool * count).toBeGreaterThanOrEqual(len);
    }
  });

  it("отрицательная длина — ошибка", () => {
    expect(() => pickSpool(-1)).toThrow();
  });

  it("подпись катушки", () => {
    expect(spoolText({ spool_m: 1500, spool_count: 1 })).toBe("1 500 м");
    expect(spoolText({ spool_m: 1000, spool_count: 6 })).toBe("6 × 1 000 м");
  });
});

describe("рекомендованное число линий", () => {
  it.each([
    [20, 1000],
    [30, 1200],
    [50, 2000],
    [70, 2800],
    [150, 5000],
  ])("%i см → %i", (d, lines) => {
    expect(recommendedLines(d)).toBe(lines);
  });
});
