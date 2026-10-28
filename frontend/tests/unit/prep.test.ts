// fs — читаем общий с бэкендом файл эталона
import fs from "node:fs";
// path — собираем путь к нему
import path from "node:path";
// Описание тестов и проверки
import { describe, expect, it } from "vitest";
// Функции подготовки фото из lib/prep.ts:
import {
  // автоуровни
  autoLevels,
  // яркость и контраст
  brightnessContrast,
  // ограничение параметров допустимыми значениями
  clampPrep,
  // квадрат кадра
  cropBox,
  // параметры по умолчанию
  DEFAULT_PREP,
  // поправка центра, когда кадр упёрся в край
  normalizeCenter,
  // сдвиг кадра мышью
  pan,
  // весь тональный конвейер
  processGray,
  // перевод цвета в серый
  toGray,
  // тип параметров подготовки
  type Prep,
} from "@/lib/prep";

// Эталон из autotests/fixtures — те же данные проверяет backend/tests/test_photo.py
const golden = JSON.parse(
  // Путь от tests/unit до корня проекта и дальше к файлу
  fs.readFileSync(path.join(__dirname, "..", "..", "..", "autotests", "fixtures", "prep-golden.json"), "utf-8"),
// Описываем форму эталона для TypeScript:
) as {
  // ширина картинки
  width: number;
  // высота
  height: number;
  // пиксели RGB подряд
  rgb: number[];
  // маска «человек/фон»
  mask: number[];
  // кейсы тона: параметры и ожидаемый результат
  cases: { prep: Prep; expected: number[] }[];
  // кейсы кадра: размер фото, параметры и ожидаемый квадрат
  crop_cases: { width: number; height: number; prep: Prep; expected: number[] }[];
};

// В эталоне пиксели RGB, а браузерный canvas отдаёт RGBA — добавляем непрозрачность
function rgbaFromRgb(rgb: number[]): number[] {
  // Результат
  const out: number[] = [];
  // Каждые три числа превращаем в четыре
  for (let i = 0; i < rgb.length; i += 3) out.push(rgb[i], rgb[i + 1], rgb[i + 2], 255);
  // Отдаём
  return out;
}

// Группа: сверка с эталоном
describe("эталон подготовки фото (общий с бэкендом)", () => {
  // Каждый кейс тона — отдельный тест, имя — параметры в JSON
  it.each(golden.cases.map((c) => [JSON.stringify(c.prep), c] as const))("%s", (_t, c) => {
    // Прогоняем весь конвейер
    const out = processGray(toGray(rgbaFromRgb(golden.rgb)), c.prep, golden.mask);
    // Самое большое расхождение с эталоном
    const maxDiff = Math.max(...Array.from(out, (v, i) => Math.abs(v - c.expected[i])));
    // Не больше одного уровня яркости
    expect(maxDiff).toBeLessThanOrEqual(1);
  });

  // Каждый кейс кадра — отдельный тест
  it.each(golden.crop_cases.map((c) => [`${c.width}×${c.height}`, c] as const))("кадр %s", (_t, c) => {
    // Считаем квадрат кадра
    const got = cropBox(c.width, c.height, c.prep);
    // Каждое число совпадает до 4 знаков
    got.forEach((v, i) => expect(v).toBeCloseTo(c.expected[i], 4));
  });
});

// Группа: кадрирование
describe("кадр", () => {
  // По умолчанию — центральный квадрат
  it("по умолчанию — центральный квадрат", () => {
    // Фото 1600×1200 → отступ 200, сторона 1200
    expect(cropBox(1600, 1200, DEFAULT_PREP)).toEqual([200, 0, 1200]);
  });

  // Центр подтягивается, если кадр уже упёрся в край
  it("центр не уезжает туда, где кадр упёрся в край", () => {
    // Зум 2 и центр почти у правого края
    const p = normalizeCenter(1000, 1000, { ...DEFAULT_PREP, zoom: 2, center_x: 0.95 });
    // Центр сдвинут туда, где кадр касается края
    expect(p.center_x).toBeCloseTo(0.75, 10);
  });

  // Перетаскивание фото мышью двигает центр в обратную сторону
  it("сдвиг мышью: вправо на всю ширину окна — центр уходит влево на сторону кадра", () => {
    // Зум 4 — кадр 250 px из 1000
    const p0 = { ...DEFAULT_PREP, zoom: 4 }; // кадр 250 из 1000 px
    // Сдвиг на 100 px экрана в окне 400 px
    const p1 = pan(1000, 1000, p0, 100, 0, 400); // 100 px экрана = 62,5 px фото
    // Центр ушёл влево на 62,5 px фото
    expect(p1.center_x).toBeCloseTo(0.5 - 62.5 / 1000, 10);
    // По вертикали не двигали
    expect(p1.center_y).toBe(0.5);
  });

  // Ограничение параметров
  it("границы параметров", () => {
    // Заведомо неверные значения
    const p = clampPrep({ ...DEFAULT_PREP, zoom: 9, brightness: -2, contrast: 5, center_x: -1 });
    // Обрезаны до допустимых
    expect([p.zoom, p.brightness, p.contrast, p.center_x]).toEqual([4, -0.5, 1, 0]);
  });
});

// Группа: тональные операции
describe("тона", () => {
  // Автоуровни растягивают 100…150 на 0…255
  it("автоуровни растягивают диапазон", () => {
    // Плавный переход от 100 до 150
    const g = Float32Array.from({ length: 10000 }, (_, i) => 100 + (50 * i) / 9999);
    // Применяем
    const out = autoLevels(g);
    // Минимум 0
    expect(Math.min(...out)).toBe(0);
    // Максимум 255
    expect(Math.max(...out)).toBe(255);
  });

  // Однотонная картинка остаётся как есть
  it("однотонная картинка не ломается", () => {
    // Три пикселя 77 → те же 77
    expect(Array.from(autoLevels(new Float32Array([77, 77, 77])))).toEqual([77, 77, 77]);
  });

  // Формулы яркости и контраста совпадают с сервером
  it("яркость и контраст — те же формулы, что на бэкенде", () => {
    // Чёрный, средний, белый
    const g = new Float32Array([0, 128, 255]);
    // Яркость +0,1
    expect(Array.from(brightnessContrast(g, 0.1, 0))).toEqual([25.5, 153.5, 255]);
    // Контраст −0,5
    expect(Array.from(brightnessContrast(g, 0, -0.5))).toEqual([64, 128, 191.5]);
  });

  // Маска делает фон белым
  it("маска делает фон белым", () => {
    // Четыре одинаковых пикселя
    const gray = new Float32Array([10, 10, 10, 10]);
    // Первые два — человек, вторые два — фон
    const out = processGray(gray, { ...DEFAULT_PREP, remove_background: true }, [255, 255, 0, 0]);
    // Фон стал белым
    expect(out[2]).toBe(255);
    // Человек остался темнее фона
    expect(out[0]).toBeLessThan(out[2]);
  });
});
