import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  autoLevels,
  brightnessContrast,
  clampPrep,
  cropBox,
  DEFAULT_PREP,
  normalizeCenter,
  pan,
  processGray,
  toGray,
  type Prep,
} from "@/lib/prep";

const golden = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "..", "autotests", "fixtures", "prep-golden.json"), "utf-8"),
) as {
  width: number;
  height: number;
  rgb: number[];
  mask: number[];
  cases: { prep: Prep; expected: number[] }[];
  crop_cases: { width: number; height: number; prep: Prep; expected: number[] }[];
};

function rgbaFromRgb(rgb: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < rgb.length; i += 3) out.push(rgb[i], rgb[i + 1], rgb[i + 2], 255);
  return out;
}

describe("эталон подготовки фото (общий с бэкендом)", () => {
  it.each(golden.cases.map((c) => [JSON.stringify(c.prep), c] as const))("%s", (_t, c) => {
    const out = processGray(toGray(rgbaFromRgb(golden.rgb)), c.prep, golden.mask);
    const maxDiff = Math.max(...Array.from(out, (v, i) => Math.abs(v - c.expected[i])));
    expect(maxDiff).toBeLessThanOrEqual(1);
  });

  it.each(golden.crop_cases.map((c) => [`${c.width}×${c.height}`, c] as const))("кадр %s", (_t, c) => {
    const got = cropBox(c.width, c.height, c.prep);
    got.forEach((v, i) => expect(v).toBeCloseTo(c.expected[i], 4));
  });
});

describe("кадр", () => {
  it("по умолчанию — центральный квадрат", () => {
    expect(cropBox(1600, 1200, DEFAULT_PREP)).toEqual([200, 0, 1200]);
  });

  it("центр не уезжает туда, где кадр упёрся в край", () => {
    const p = normalizeCenter(1000, 1000, { ...DEFAULT_PREP, zoom: 2, center_x: 0.95 });
    expect(p.center_x).toBeCloseTo(0.75, 10);
  });

  it("сдвиг мышью: вправо на всю ширину окна — центр уходит влево на сторону кадра", () => {
    const p0 = { ...DEFAULT_PREP, zoom: 4 }; // кадр 250 из 1000 px
    const p1 = pan(1000, 1000, p0, 100, 0, 400); // 100 px экрана = 62,5 px фото
    expect(p1.center_x).toBeCloseTo(0.5 - 62.5 / 1000, 10);
    expect(p1.center_y).toBe(0.5);
  });

  it("границы параметров", () => {
    const p = clampPrep({ ...DEFAULT_PREP, zoom: 9, brightness: -2, contrast: 5, center_x: -1 });
    expect([p.zoom, p.brightness, p.contrast, p.center_x]).toEqual([4, -0.5, 1, 0]);
  });
});

describe("тона", () => {
  it("автоуровни растягивают диапазон", () => {
    const g = Float32Array.from({ length: 10000 }, (_, i) => 100 + (50 * i) / 9999);
    const out = autoLevels(g);
    expect(Math.min(...out)).toBe(0);
    expect(Math.max(...out)).toBe(255);
  });

  it("однотонная картинка не ломается", () => {
    expect(Array.from(autoLevels(new Float32Array([77, 77, 77])))).toEqual([77, 77, 77]);
  });

  it("яркость и контраст — те же формулы, что на бэкенде", () => {
    const g = new Float32Array([0, 128, 255]);
    expect(Array.from(brightnessContrast(g, 0.1, 0))).toEqual([25.5, 153.5, 255]);
    expect(Array.from(brightnessContrast(g, 0, -0.5))).toEqual([64, 128, 191.5]);
  });

  it("маска делает фон белым", () => {
    const gray = new Float32Array([10, 10, 10, 10]);
    const out = processGray(gray, { ...DEFAULT_PREP, remove_background: true }, [255, 255, 0, 0]);
    expect(out[2]).toBe(255);
    expect(out[0]).toBeLessThan(out[2]);
  });
});
