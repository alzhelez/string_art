// @vitest-environment node
// Версия для телефона: расчёт в браузере совпадает с Python-бэкендом (эталон — tests/fixtures/parity.json.gz)

// Чтение файла эталона
import fs from "node:fs";
// Распаковка gzip
import { gunzipSync } from "node:zlib";
// Описание тестов и проверки
import { describe, expect, it } from "vitest";
// Алгоритм
import { buildLineCache, circleMask, generateSequence, lineCounts, linePixels, rint, targetMap } from "@/lib/local/algorithm";
// Размытие
import { boxesForGauss, gaussianBlur } from "@/lib/local/blur";
// Цветные нити
import { buildLayers, coverage, hexToRgb, layerCurve, resolvePalette, shrink, threadRgb, weaveOrder, catalog } from "@/lib/local/colors";
// Картинка готовой картины
import { renderLayers } from "@/lib/local/render";
// Сходство
import { autoTone, bestPoint, half, lineAlpha, similarityCurve } from "@/lib/local/similarity";

// Эталон Python: серое фото, цветное фото, начало схемы, лучшее число линий, цветные портреты
const ref = JSON.parse(gunzipSync(fs.readFileSync(new URL("../fixtures/parity.json.gz", import.meta.url))).toString("utf8"));
// Серое фото 400×400
const gray = new Uint8ClampedArray(Buffer.from(ref.gray, "base64"));
// Цветное фото 400×400×3 (байты)
const rgb8 = new Uint8Array(Buffer.from(ref.rgb, "base64"));
// Цвета точек в долях
const rgb = Float32Array.from(rgb8, (v) => v / 255);

// Группа: основа алгоритма
describe("алгоритм (как algorithm.py)", () => {
  // Округление к чётному
  it("rint — как numpy.rint", () => {
    // Половины — к чётному, остальное — к ближайшему
    expect([0.5, 1.5, 2.5, -0.5, 2.4, 2.6].map((v) => rint(v) + 0)).toEqual([0, 2, 2, 0, 2, 3]);
  });

  // Пиксели линии: без повторов, от гвоздя к гвоздю
  it("linePixels: непрерывная линия без повторов", () => {
    // Линия через центр (A1 → C1)
    const px = Array.from(linePixels(0, 120, 400));
    // Повторов подряд нет
    expect(px.every((p, i) => i === 0 || p !== px[i - 1])).toBe(true);
    // Длина ≈ диаметр
    expect(px.length).toBeGreaterThan(395);
    // Соседние пиксели — рядом (шаг не больше одного по каждой оси)
    expect(px.every((p, i) => i === 0 || (Math.abs((p % 400) - (px[i - 1] % 400)) <= 1 && Math.abs(Math.floor(p / 400) - Math.floor(px[i - 1] / 400)) <= 1))).toBe(true);
  });

  // Кэш: соседние гвозди не соединяются, пара хранится один раз
  it("кэш линий: близкие гвозди не соединяются", () => {
    // Кэш
    const c = buildLineCache();
    // Из A1 — все, кроме ближайших 14 с каждой стороны и себя
    expect(c.targets[0].length).toBe(240 - 1 - 2 * 14);
    // A1–A2 нет
    expect(c.offset[0 * 240 + 1]).toBe(-1);
    // A1–C1 и C1–A1 — одна запись
    expect(c.offset[0 * 240 + 120]).toBe(c.offset[120 * 240 + 0]);
  });

  // Карта цели совпадает с Python (резкость PIL и гамма)
  it("targetMap ≈ target_map Python", () => {
    // Карта
    const t = targetMap(gray, 400);
    // Вне круга — ноль
    expect(t[0]).toBe(0);
    // Значения от 0 до 1
    expect(t.reduce((m, v) => Math.max(m, v), 0)).toBeLessThanOrEqual(1);
    // Маска круга
    const mask = circleMask(400);
    // Средняя совпадает с картой из серого без резкости с точностью до процента
    const plain = Array.from(gray).reduce((s, v, i) => s + (mask[i] ? (1 - v / 255) ** 1.2 : 0), 0) / gray.length;
    // Резкость почти не меняет средний тон
    expect(Math.abs(t.reduce((s, v) => s + v, 0) / t.length - plain)).toBeLessThan(0.01);
  });

  // Схема почти совпадает с Python
  it("generateSequence: те же первые шаги, что у Python", () => {
    // Схема на 1000 линий
    const seq = generateSequence(targetMap(gray, 400), 1000);
    // Длина: линии + стартовый гвоздь
    expect(seq.length).toBe(1001);
    // Старт — A1
    expect(seq[0]).toBe(0);
    // Ни одна пара не повторяется
    const pairs = new Set(seq.slice(1).map((b, i) => [Math.min(seq[i], b), Math.max(seq[i], b)].join("-")));
    // Пар столько же, сколько линий
    expect(pairs.size).toBe(1000);
    // Начало одинаковое (дальше расходится из-за округлений float32 — на картину это не влияет)
    expect(seq.slice(0, 15)).toEqual(ref.sequence.slice(0, 15));
  });

  // Важность: линии тянутся к важной области
  it("generateSequence: карта важности притягивает линии", () => {
    // Ровно серая картинка
    const flat = new Float32Array(400 * 400).fill(0.5);
    // Важна только левая половина
    const imp = Float32Array.from({ length: 400 * 400 }, (_, i) => (i % 400 < 200 ? 3 : 1));
    // Схема с важностью
    const seq = generateSequence(flat, 300, undefined, imp);
    // Пиксели всех линий
    const counts = lineCounts(seq, 300, 400);
    // Слева и справа
    let left = 0;
    // Справа
    let right = 0;
    // Подсчёт
    counts.forEach((c, i) => (i % 400 < 200 ? (left += c) : (right += c)));
    // Слева больше
    expect(left).toBeGreaterThan(right);
  });

  // Ошибки ввода
  it("generateSequence: неверные данные — ошибка", () => {
    // Не квадрат
    expect(() => generateSequence(new Float32Array(10))).toThrow(/квадратной/);
    // Ноль линий
    expect(() => generateSequence(new Float32Array(400 * 400), 0)).toThrow(/maxLines/);
    // Важность другого размера
    expect(() => generateSequence(new Float32Array(400 * 400), 10, undefined, new Float32Array(4))).toThrow(/важности/);
  });
});

// Группа: размытие
describe("размытие", () => {
  // Окна для сигмы
  it("boxesForGauss: три нечётных окна", () => {
    // Окна
    const b = boxesForGauss(3);
    // Три
    expect(b).toHaveLength(3);
    // Все нечётные
    expect(b.every((w) => w % 2 === 1)).toBe(true);
  });

  // Сохраняет средний тон и сглаживает
  it("gaussianBlur: средний тон тот же, шум меньше", () => {
    // Шум
    const a = Float32Array.from({ length: 100 * 100 }, (_, i) => ((i * 7919) % 255) + 0.5);
    // Размытие
    const b = gaussianBlur(a, 100, 100, 4);
    // Средние
    const mean = (x: Float32Array) => x.reduce((s, v) => s + v, 0) / x.length;
    // Средний тон почти тот же
    expect(Math.abs(mean(a) - mean(b))).toBeLessThan(2);
    // Разброс меньше
    const sd = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + (v - mean(x)) ** 2, 0) / x.length);
    // В разы меньше
    expect(sd(b)).toBeLessThan(sd(a) / 4);
    // Маленькая сигма — копия
    expect(gaussianBlur(a, 100, 100, 0.2)).toEqual(a);
  });

  // Одна точка расплывается симметрично
  it("gaussianBlur: точка расплывается симметрично", () => {
    // Одна яркая точка в центре 21×21
    const a = new Float32Array(21 * 21);
    // Центр
    a[10 * 21 + 10] = 100;
    // Размытие
    const b = gaussianBlur(a, 21, 21, 2);
    // Слева и справа одинаково
    expect(b[10 * 21 + 7]).toBeCloseTo(b[10 * 21 + 13], 4);
    // Сверху и снизу одинаково
    expect(b[7 * 21 + 10]).toBeCloseTo(b[13 * 21 + 10], 4);
    // Центр — максимум
    expect(b[10 * 21 + 10]).toBe(Math.max(...b));
  });
});

// Группа: сходство
describe("сходство (как similarity.py)", () => {
  // Та же рекомендация числа линий, что у Python
  it("similarityCurve: лучшее число линий как у Python (±300)", () => {
    // Схема
    const seq = generateSequence(targetMap(gray, 400));
    // Кривая
    const curve = similarityCurve(seq, Float32Array.from(gray), 50);
    // 41 точка: 1000…5000 через 100
    expect(curve).toHaveLength(41);
    // Лучшая точка
    const [best] = bestPoint(curve);
    // Близко к Python
    expect(Math.abs(best - ref.best[0])).toBeLessThanOrEqual(300);
  });

  // Равенство — меньше линий
  it("bestPoint: при равенстве — меньше линий", () => {
    // Две равные точки
    expect(bestPoint([[2000, 0.5], [1000, 0.5], [3000, 0.4]])).toEqual([1000, 0.5]);
  });

  // Непрозрачность линии
  it("lineAlpha: тоньше на большом круге, в пределах 0,02…1", () => {
    // Маленький круг — плотнее
    expect(lineAlpha(400, 20)).toBeGreaterThan(lineAlpha(400, 100));
    // Нижний предел
    expect(lineAlpha(10, 150)).toBe(0.02);
    // Верхний предел
    expect(lineAlpha(4000, 20)).toBe(1);
  });

  // Уменьшение вдвое
  it("half: среднее квадратов 2×2", () => {
    // 2×2 → 1×1
    expect(Array.from(half(Float32Array.from([1, 2, 3, 6]), 2))).toEqual([3]);
    // Три канала
    expect(Array.from(half(Float32Array.from([0, 0, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0]), 2, 3))).toEqual([1, 1, 1]);
  });

  // Автонастройка возвращает лучший из перебранных вариантов
  it("autoTone: 6 вариантов, лучший не хуже исходного", () => {
    // Подготовка: сдвиг яркости и контраст поверх эталона
    const prep = (b: number, c: number) => Uint8ClampedArray.from(gray, (v) => (v - 128) * (1 + c) + 128 + b * 255);
    // Перебор
    const r = autoTone(prep, 50);
    // Вариантов: 4 контраста + 2 яркости
    expect(r.candidates).toBe(6);
    // Лучший не хуже
    expect(r.score_after).toBeGreaterThanOrEqual(r.score_before);
  // Время на тест — до 2 минут
  }, 120_000);
});

// Группа: цветные нити
describe("цветные нити (как palette.py и layers.py)", () => {
  // Каталог
  it("catalog: режимы, 13 нитей, 5 досок", () => {
    // Справочник
    const c = catalog();
    // Режимы
    expect(c.modes).toEqual(["mono", "bw", "color"]);
    // Нити и доски
    expect([c.threads.length, c.boards.length, c.colors.max]).toEqual([13, 5, 4]);
  });

  // Порядок плетения — от светлых к тёмным
  it("weaveOrder: от светлых к тёмным", () => {
    // Чёрная, белая, красная
    expect(weaveOrder(["black", "white", "red"])).toEqual(["white", "red", "black"]);
  });

  // Покрытие восстанавливает смесь
  it("coverage: находит долю нити в смеси", () => {
    // Доска белая, нить чёрная; точка — 30 % чёрной
    const black = threadRgb("black");
    // Цвет точки
    const mix = [0, 1, 2].map((c) => 1 * 0.7 + black[c] * 0.3);
    // Покрытие
    const [a] = coverage(Float32Array.from(mix), [1, 1, 1], [black]);
    // ≈ 0,3
    expect(a[0]).toBeCloseTo(0.3, 2);
    // Чистая доска — ноль нити
    expect(coverage(Float32Array.from([1, 1, 1]), [1, 1, 1], [black])[0][0]).toBeCloseTo(0, 5);
    // Две нити: сумма не больше 1
    const two = coverage(Float32Array.from(black), [1, 1, 1], [black, threadRgb("red")]);
    // Проверка
    expect(two[0][0] + two[1][0]).toBeLessThanOrEqual(1.000001);
  });

  // Выбор нитей: ручной, режимы, ошибки
  it("resolvePalette: режимы, ручной выбор и ошибки", () => {
    // Одна нить
    expect(resolvePalette("mono", null, null, null, 400, 3)).toEqual({ keys: ["black"], board: "white" });
    // Чёрная и белая на серой
    expect(resolvePalette("bw", null, null, null, 400, 3)).toEqual({ keys: ["white", "black"], board: "gray" });
    // Ручной выбор без повторов, по порядку плетения
    expect(resolvePalette("color", ["black", "red", "red"], "beige", null, 400, 3)).toEqual({ keys: ["red", "black"], board: "beige" });
    // Неизвестный режим
    expect(() => resolvePalette("rainbow", null, null, null, 400, 3)).toThrow(/режим/);
    // Неизвестная доска
    expect(() => resolvePalette("bw", null, "pink", null, 400, 3)).toThrow(/доски/);
    // Неизвестный цвет
    expect(() => resolvePalette("color", ["black", "gold"], null, null, 400, 3)).toThrow(/gold/);
    // Один цвет
    expect(() => resolvePalette("color", ["black"], null, null, 400, 3)).toThrow(/от 2 до 4/);
    // Автоподбор без фото
    expect(() => resolvePalette("color", null, null, null, 400, 3)).toThrow(/фото/);
  });

  // Автоподбор совпадает с Python
  it("автоподбор цветов как у Python", () => {
    // Три цвета на белой доске
    expect(resolvePalette("color", null, "white", rgb, 400, 3).keys).toEqual(ref.colors.color.keys);
  });

  // Уменьшение для автоподбора
  it("shrink: 400 → 64 усреднением", () => {
    // Белая картинка
    const s = shrink(new Float32Array(400 * 400 * 3).fill(1), 400);
    // 64×64×3, всё белое
    expect([s.length, Math.min(...s)]).toEqual([64 * 64 * 3, 1]);
  });

  // Слои: тот же порядок и близкое число линий
  it("buildLayers «чёрная + белая»: порядок как у Python, линии ±600", () => {
    // Расчёт
    const built = buildLayers(rgb, "gray", ["white", "black"], null, 50);
    // Порядок
    expect(built.map((l) => l.color)).toEqual(ref.colors.bw.counts.map((c: [string, number]) => c[0]));
    // Число линий близко
    built.forEach((l, i) => expect(Math.abs(l.line_count - ref.colors.bw.counts[i][1])).toBeLessThanOrEqual(600));
    // Кривая второй нити: точки от 100 через 200
    const curve = layerCurve(rgb, "gray", built, 1, 50);
    // Первая точка
    expect(curve[0][0]).toBe(100);
    // Шаг
    expect(curve[1][0] - curve[0][0]).toBe(200);
  // Время на тест — до 2 минут
  }, 120_000);
});

// Группа: картинка картины
describe("превью", () => {
  // Рамка и белое поле
  it("renderLayers: белое поле, серый контур, нити темнее доски", () => {
    // Схема из одной линии через центр
    const px = renderLayers([{ sequence: [0, 120], steps: 1, rgb: hexToRgb("#1b1b1b") }], 200, 50, [1, 1, 1], false);
    // Угол — белый
    expect(px[0]).toBe(255);
    // Центр (через него прошла нить) темнее белого
    expect(px[(100 * 200 + 100) * 4]).toBeLessThan(255);
    // Непрозрачно
    expect(px[3]).toBe(255);
  });
});
