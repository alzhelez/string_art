// Тесты по итогам мутационного тестирования (Stryker): то, что раньше «выживало».
// Точные значения вместо «примерно», граничные случаи, все клавиши и фразы, рисование кадра.

// Описание тестов, хуки, проверки и подмены
import { afterEach, describe, expect, it, vi } from "vitest";
// Клавиши и голос
import { KEY_NAMES, keyCommand, voiceCommand } from "@/lib/control";
// Прогноз времени
import { dailyAverageSec, duration, estimate, finishText, secPerStep } from "@/lib/eta";
// Склонения
import { plural } from "@/lib/format";
// Слои портрета
import { layerTitle, projectLayers } from "@/lib/layers";
// Гвозди
import { chordLength, nailGap, nailLabel, nailNumber, nailSector, parseLabel, sectorCenterAngle } from "@/lib/nails";
// Кадр и тон
import { cropBox, DEFAULT_PREP, drawPrepared, levelBounds, pan, processColor, processGray, toGray, type Prep } from "@/lib/prep";
// Смены катушки
import { planSpools } from "@/lib/spool";
// Леска
import { pickSpool, rawLengthM, threadStats } from "@/lib/thread";
// Обновления
import { dismiss, isDismissed, isNewer, latestRelease, parseVersion, RELEASE_API, RELEASE_PAGE, releaseFromGithub } from "@/lib/update";
// Типы
import type { Activity, Project, ProjectSummary } from "@/lib/api";

// --- катушки --------------------------------------------------------------------------------

// Схема «A1 ↔ C1»: на круге 100 см каждая нить — ровно 1 м (диаметр)
const ACROSS = Array.from({ length: 251 }, (_, i) => (i % 2 ? 120 : 0));

// Группа: план смены катушки
describe("planSpools: точный план", () => {
  // Узел — на гвозде, через который проходит больше нитей, в последних 3 % катушки
  it("катушка 101,5 м: узлы после 100-го и 200-го шага на A1", () => {
    // Без запаса — расход ровно 1 м на шаг
    const { changes, spools } = planSpools(ACROSS, 250, 100, 101.5, 0);
    // Две смены, три катушки
    expect(spools).toBe(3);
    // Первая: шаг 101 (гвоздь C1) — но на A1 нитей больше, поэтому шаг 100
    expect(changes).toEqual([
      // Смена 1
      { spool: 1, afterStep: 100, nail: 0, label: "A1", usedM: 100 },
      // Смена 2
      { spool: 2, afterStep: 200, nail: 0, label: "A1", usedM: 200 },
    ]);
  });

  // Остаток ровно равен ёмкости — новой смены нет
  it("остаток ровно с катушку — без лишней смены", () => {
    // 20 м, катушка на 10 м + 0,5 на узлы
    const { changes } = planSpools(ACROSS, 20, 100, 10.5, 0);
    // Одна смена после 10-го шага
    expect(changes.map((c) => c.afterStep)).toEqual([10]);
  });

  // Слишком короткая катушка (≤ 2 м) — не планируем
  it("катушка 2 м — не планируем; 2,5 м — планируем", () => {
    // Ровно 4 × 0,5 м
    expect(planSpools(ACROSS, 250, 100, 2, 0)).toEqual({ changes: [], spools: 1 });
    // Чуть больше — смены есть
    expect(planSpools(ACROSS, 10, 100, 2.5, 0).changes.length).toBeGreaterThan(0);
  });

  // Нить длиннее катушки — планировать нечего (и без зависания)
  it("нить длиннее катушки — без смен", () => {
    // Круг 300 см: нить 3 м, катушка 3 м (ёмкость 2,5 м)
    expect(planSpools(ACROSS, 10, 300, 3, 0)).toEqual({ changes: [], spools: 1 });
  });

  // Запас учитывается и округляется до десятых
  it("запас 15 % и округление расхода", () => {
    // Катушка 101,5 м при запасе 15 %: ёмкость 101 м = 87,8 шага
    const [first] = planSpools(ACROSS, 250, 100, 101.5, 0.15).changes;
    // После 87-го шага (A1? 87 — нечётный, C1; 86 — A1 в окне 3 %)
    expect([first.afterStep, first.usedM]).toEqual([86, Math.round(86 * 1.15 * 10) / 10]);
  });
});

// --- клавиши и голос ------------------------------------------------------------------------

// Группа: управление без рук
describe("клавиши и голос: все варианты", () => {
  // Каждая клавиша
  it.each([
    // Вперёд
    ["ArrowRight", "next"], ["PageDown", "next"], ["MediaTrackNext", "next"],
    // Назад
    ["ArrowLeft", "prev"], ["PageUp", "prev"], ["MediaTrackPrevious", "prev"],
    // Пауза / продолжить
    [" ", "toggle"], ["MediaPlayPause", "toggle"], ["b", "toggle"], ["B", "toggle"], ["и", "toggle"], ["И", "toggle"], [".", "toggle"],
    // Стоп
    ["MediaStop", "pause"],
    // Скорость
    ["ArrowUp", "faster"], ["ArrowDown", "slower"],
    // Ничего
    ["x", null], ["", null],
    // Проверка одной клавиши
  ])("клавиша %j → %s", (key, cmd) => {
    // Код клавиши — не пробел
    expect(keyCommand({ key, code: "KeyX" })).toBe(cmd);
  });

  // Пробел по коду (раскладки, где key другой)
  it("код Space → toggle", () => {
    // Неизвестный key, но код пробела
    expect(keyCommand({ key: "Unidentified", code: "Space" })).toBe("toggle");
  });

  // Подписи клавиш — точные
  it("KEY_NAMES", () => {
    // Весь словарь
    expect(KEY_NAMES).toEqual({
      // Пробел
      " ": "Пробел",
      // Стрелки
      ArrowRight: "→", ArrowLeft: "←", ArrowUp: "↑", ArrowDown: "↓",
      // Кликер
      PageDown: "PageDown", PageUp: "PageUp",
      // Медиаклавиши
      MediaTrackNext: "медиа «следующий»", MediaTrackPrevious: "медиа «предыдущий»", MediaPlayPause: "медиа «пауза»",
    });
  });

  // Каждое слово каждой команды
  it.each([
    // Вперёд
    ...["дальше", "далее", "вперёд", "следующий", "следующая", "next", "го", "давай"].map((w) => [w, "next"]),
    // Назад
    ...["назад", "обратно", "предыдущий", "предыдущая", "верни", "back"].map((w) => [w, "prev"]),
    // Стоп
    ...["стоп", "пауза", "стой", "подожди", "хватит", "stop", "pause"].map((w) => [w, "pause"]),
    // Старт
    ...["старт", "поехали", "продолжи", "продолжить", "продолжай", "начали", "play", "start"].map((w) => [w, "play"]),
    // Быстрее
    ...["быстрее", "побыстрее", "ускорь"].map((w) => [w, "faster"]),
    // Медленнее
    ...["медленнее", "помедленнее", "притормози", "замедли"].map((w) => [w, "slower"]),
    // Повтор
    ...["повтори", "ещё раз", "какой шаг", "где я"].map((w) => [w, "repeat"]),
    // Проверка одной фразы
  ])("голос %j → %s", (phrase, cmd) => {
    // Сама фраза
    expect(voiceCommand(phrase)).toBe(cmd);
    // Слово внутри фразы — не команда (якоря ^ и $)
    expect(voiceCommand(`не ${phrase}`)).toBeNull();
    // Хвост после команды — тоже не команда
    expect(voiceCommand(`${phrase} нет`)).toBeNull();
  });

  // Нормализация фразы
  it("пунктуация, пробелы и обращение «нить»", () => {
    // Запятая — как пробел
    expect(voiceCommand("Нить,дальше")).toBe("next");
    // Много пробелов — как один
    expect(voiceCommand("нить   дальше")).toBe("next");
    // Три слова с обращением
    expect(voiceCommand("слушай ещё раз")).toBe("repeat");
    // Обращение только в начале фразы
    expect(voiceCommand("еще нить раз")).toBeNull();
    // Четыре слова — не команда
    expect(voiceCommand("ну давай же дальше")).toBeNull();
    // Пусто
    expect(voiceCommand(" ... ")).toBeNull();
  });
});

// --- кадр и тон -------------------------------------------------------------------------------

// Группа: подготовка фото
describe("кадр и тон: точные значения", () => {
  // Кадр не выходит за нижний край
  it("cropBox: центр у края — кадр прижат к краю", () => {
    // Фото 100×300, центр в самом низу
    expect(cropBox(100, 300, { ...DEFAULT_PREP, center_y: 1 })).toEqual([0, 200, 100]);
  });

  // Сдвиг по вертикали
  it("pan: вниз на 10 px экрана при двукратном зуме", () => {
    // Фото 400×400, зум 2 → кадр 200 px; окно 100 px → 2 px фото на пиксель экрана
    const p = pan(400, 400, { ...DEFAULT_PREP, zoom: 2 }, 0, 10, 100);
    // Центр выше на 20 px из 400
    expect(p.center_y).toBeCloseTo(0.45, 10);
  });

  // Границы автоуровней: 1 % отсечки с каждой стороны
  it("levelBounds: строгие и нестрогие границы", () => {
    // 100 точек: одна 0, 49 по 50, 49 по 100, одна 255
    const g = Float32Array.from([0, ...Array(49).fill(50), ...Array(49).fill(100), 255]);
    // Нижняя — 50 (ровно 1 % не считается), верхняя — 100 (ровно 99 % считается)
    expect(levelBounds(g)).toEqual([50, 100]);
  });

  // Округление к чётному на половинах (как numpy)
  it("processGray: 2,5 → 2, 3,5 → 4", () => {
    // Ровные картинки (автоуровни не меняют)
    const r = (v: number) => processGray(new Float32Array(4).fill(v), DEFAULT_PREP)[0];
    // Половины и не половины
    expect([r(2.5), r(3.5), r(2.4), r(2.6)]).toEqual([2, 4, 2, 3]);
  });

  // Цветная обработка: уровни по серому, контраст, яркость, фон — цвет доски
  it("processColor: точное значение и фон", () => {
    // 100 точек: 49 чёрных, 49 серых 200, 2 по 100
    const values = [...Array(49).fill(0), ...Array(49).fill(200), 100, 100];
    // RGBA
    const rgba = Uint8ClampedArray.from(values.flatMap((v) => [v, v, v, 255]));
    // Маска: последняя точка — фон
    const mask = Uint8Array.from(values.map((_, i) => (i === 99 ? 0 : 255)));
    // Контраст 0,5, яркость 0,1, фон убран
    const p: Prep = { ...DEFAULT_PREP, contrast: 0.5, brightness: 0.1, remove_background: true };
    // Обработка, доска синяя
    const out = processColor(rgba, p, mask, [10, 20, 30]);
    // Точка 100: уровни ×255/200 → 127,5; контраст → 127,25; яркость +25,5 → 152,75 → 153
    expect(Array.from(out.slice(98 * 4, 98 * 4 + 4))).toEqual([153, 153, 153, 255]);
    // Фон — цвет доски
    expect(Array.from(out.slice(99 * 4, 99 * 4 + 4))).toEqual([10, 20, 30, 255]);
    // Без «убрать фон» маска не применяется
    expect(Array.from(processColor(rgba, { ...p, remove_background: false }, mask, [10, 20, 30]).slice(99 * 4, 99 * 4 + 3))).toEqual([153, 153, 153]);
  });
});

// Холст-заглушка: запоминает, что на нём рисовали, и отдаёт пиксели источника
class FakeCtx {
  // Что нарисовали последним
  drawn: { pixels: (w: number, h: number) => Uint8ClampedArray } | null = null;
  // Аргументы drawImage
  args: number[] = [];
  // Что положили putImageData
  put: ImageData | null = null;
  // Цвет заливки
  fillStyle = "";
  // Залили ли
  filled = false;
  // Сглаживание
  imageSmoothingEnabled = false;
  // Качество сглаживания
  imageSmoothingQuality = "";
  // Рисование источника
  drawImage(src: FakeCtx["drawn"], ...args: number[]) {
    // Запоминаем
    this.drawn = src;
    // Аргументы
    this.args = args;
  }
  // Заливка
  fillRect() {
    // Отмечаем
    this.filled = true;
  }
  // Пиксели — от источника
  getImageData(_x: number, _y: number, w: number, h: number) {
    // Данные
    return { data: this.drawn!.pixels(w, h) };
  }
  // Пустая картинка
  createImageData(w: number, h: number) {
    // Данные
    return { data: new Uint8ClampedArray(w * h * 4) };
  }
  // Положить картинку
  putImageData(img: ImageData) {
    // Запоминаем
    this.put = img;
  }
}

// Группа: рисование кадра
describe("drawPrepared на холсте-заглушке", () => {
  // Холсты → их контексты
  let contexts: Map<HTMLCanvasElement, FakeCtx | null>;
  // Отдавать ли контекст
  let available: (c: HTMLCanvasElement) => boolean;

  // Подмена getContext
  function install() {
    // С нуля
    contexts = new Map();
    // Подмена
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      // Ещё нет — создаём
      if (!contexts.has(this)) contexts.set(this, available(this) ? new FakeCtx() : null);
      // Контекст
      return contexts.get(this) as unknown as RenderingContext;
      // Тип подмены — как у настоящего getContext
    } as unknown as typeof HTMLCanvasElement.prototype.getContext);
  }

  // После теста — настоящий getContext из setup
  afterEach(() => vi.restoreAllMocks());

  // Источник: картинка width×height, пиксели — функцией
  const source = (width: number, height: number, value: (i: number) => number) => ({
    // Ширина
    width,
    // Высота
    height,
    // Пиксели кадра
    pixels: (w: number, h: number) => Uint8ClampedArray.from({ length: w * h * 4 }, (_, k) => (k % 4 === 3 ? 255 : value(k >> 2))),
  });

  // Серый режим: пиксели — как processGray, кадр — с качественным уменьшением на белом
  it("серый кадр: те же пиксели, что processGray", () => {
    // Все холсты рабочие
    available = () => true;
    // Подмена
    install();
    // Цель
    const target = document.createElement("canvas");
    // Фото 4×4 с градиентом
    const img = source(4, 4, (i) => i * 16);
    // Рисуем 2×2
    expect(drawPrepared(target, img as unknown as CanvasImageSource & { width: number; height: number }, null, DEFAULT_PREP, 2)).toBe(true);
    // Холст кадра (первый созданный, не цель)
    const crop = [...contexts.entries()].find(([c]) => c !== target)![1]!;
    // Кадр: весь квадрат 4×4 → 2×2
    expect(crop.args).toEqual([0, 0, 4, 4, 0, 0, 2, 2]);
    // Белый фон, сглаживание «high»
    expect([crop.fillStyle, crop.filled, crop.imageSmoothingEnabled, crop.imageSmoothingQuality]).toEqual(["#fff", true, true, "high"]);
    // Ожидание — processGray от тех же пикселей
    const expected = processGray(toGray(img.pixels(2, 2)), DEFAULT_PREP);
    // Положенная картинка
    const put = contexts.get(target)!.put!.data;
    // Каждая точка: R = G = B = ожидание, непрозрачно
    expect(Array.from(put)).toEqual(Array.from(expected).flatMap((v) => [v, v, v, 255]));
  });

  // Маска другого размера, режим кисти: убранный фон — бледно-розовый
  it("маска вдвое больше фото: кадр в её масштабе, фон подсвечен", () => {
    // Все холсты рабочие
    available = () => true;
    // Подмена
    install();
    // Цель
    const target = document.createElement("canvas");
    // Фото 4×4 серое 100
    const img = source(4, 4, () => 100);
    // Маска 8×8: первая точка кадра — фон, остальные — человек
    const mask = source(8, 8, (i) => (i === 0 ? 0 : 255));
    // С убранным фоном и подсветкой
    const p = { ...DEFAULT_PREP, remove_background: true };
    // Рисуем
    drawPrepared(target, img as never, mask as never, p, 2, { showRemoved: true });
    // Холст маски — тот, на котором рисовали маску
    const maskCtx = [...contexts.values()].find((c) => c?.drawn === mask)!;
    // Кадр в масштабе маски (×2)
    expect(maskCtx.args).toEqual([0, 0, 8, 8, 0, 0, 2, 2]);
    // Картинка
    const put = contexts.get(target)!.put!.data;
    // Серое после обработки (маска применена)
    const g = processGray(toGray(img.pixels(2, 2)), p, Uint8Array.from([0, 255, 255, 255]));
    // Точка фона: розовая подсветка 150 + серое·0,4 (a = 0)
    const t = 150 + 100 * 0.4;
    // R, G, B точки фона
    expect(Array.from(put.slice(0, 3))).toEqual([Math.round(t), Math.round(t * 0.72), Math.round(t * 0.8)]);
    // Человек — без подсветки
    expect(Array.from(put.slice(4, 8))).toEqual([g[1], g[1], g[1], 255]);
  });

  // Цветной режим: пиксели — как processColor
  it("цветной кадр: те же пиксели, что processColor", () => {
    // Все холсты рабочие
    available = () => true;
    // Подмена
    install();
    // Цель
    const target = document.createElement("canvas");
    // Фото с градиентом
    const img = source(4, 4, (i) => i * 30);
    // Рисуем на «серой доске»
    drawPrepared(target, img as never, null, DEFAULT_PREP, 2, { board: "#9a9a9a" });
    // Ожидание
    const expected = processColor(img.pixels(2, 2), DEFAULT_PREP, null, [154, 154, 154]);
    // Совпадает
    expect(Array.from(contexts.get(target)!.put!.data)).toEqual(Array.from(expected));
  });

  // Нет холста для кадра или для цели — false
  it("без холста — false", () => {
    // Ни одного контекста
    available = () => false;
    // Подмена
    install();
    // Нет кадра
    expect(drawPrepared(document.createElement("canvas"), source(4, 4, () => 0) as never, null, DEFAULT_PREP, 2)).toBe(false);
    // Цель без контекста, кадр — с ним
    const target = document.createElement("canvas");
    // Только не цель
    available = (c) => c !== target;
    // Подмена заново
    install();
    // Нет цели
    expect(drawPrepared(target, source(4, 4, () => 0) as never, null, DEFAULT_PREP, 2)).toBe(false);
  });
});

// --- гвозди и леска --------------------------------------------------------------------------

// Группа: гвозди
describe("гвозди: точные значения и тексты ошибок", () => {
  // Середины секторов
  it("sectorCenterAngle", () => {
    // A — −45°, B — 45°, D — 225°
    expect([sectorCenterAngle(0), sectorCenterAngle(1), sectorCenterAngle(3)].map((a) => +a.toFixed(6))).toEqual(
      // Ожидание
      [-Math.PI / 4, Math.PI / 4, (5 * Math.PI) / 4].map((a) => +a.toFixed(6)),
    );
  });

  // Номер вне круга — понятная ошибка во всех функциях
  it("проверка номера в nailSector, nailNumber, nailLabel", () => {
    // Текст ошибки
    const msg = "Индекс гвоздя должен быть 0..239, получено 240";
    // Сектор
    expect(() => nailSector(240)).toThrow(msg);
    // Номер в секторе
    expect(() => nailNumber(-1)).toThrow("получено -1");
    // Подпись
    expect(() => nailLabel(240)).toThrow(msg);
  });

  // Разбор подписи
  it("parseLabel: якоря и тексты ошибок", () => {
    // Мусор
    expect(() => parseLabel("xA1")).toThrow("Некорректная метка гвоздя: xA1");
    // Хвост
    expect(() => parseLabel("A1x")).toThrow("Некорректная метка гвоздя: A1x");
    // Номер вне 1..60
    expect(() => parseLabel("A61")).toThrow("Номер гвоздя должен быть 1..60");
    // Пробелы и дефис
    expect(parseLabel(" b-2 ")).toBe(61);
  });

  // Расстояние и хорда
  it("nailGap и chordLength", () => {
    // 10 и 20 — 10 шагов
    expect(nailGap(10, 20)).toBe(10);
    // Четверть круга на диаметре 2: 2·sin(45°)
    expect(chordLength(0, 60, 2)).toBeCloseTo(Math.SQRT2, 10);
  });
});

// Группа: леска
describe("леска: границы", () => {
  // Пределы шагов
  it("rawLengthM: 0 шагов — 0 м, −1 и лишние — ошибка", () => {
    // Ноль шагов
    expect(rawLengthM([0, 120], 0, 100)).toBe(0);
    // Отрицательное
    expect(() => rawLengthM([0, 120], -1, 100)).toThrow("steps вне диапазона");
    // Больше схемы
    expect(() => rawLengthM([0, 120], 2, 100)).toThrow("steps вне диапазона");
  });

  // Тексты и шаг гвоздей
  it("pickSpool и шаг гвоздей", () => {
    // Отрицательная длина
    expect(() => pickSpool(-1)).toThrow("Длина не может быть отрицательной");
    // Круг 50 см: π·500/240 = 6,54 мм
    expect(threadStats([0, 120], 1, 50).nail_spacing_mm).toBe(6.54);
  });

  // Склонения на границах
  it("plural: 4, 24 — «шага»", () => {
    // Формы
    const f: [string, string, string] = ["шаг", "шага", "шагов"];
    // Границы
    expect([plural(4, f), plural(24, f), plural(5, f), plural(11, f), plural(21, f)]).toEqual(["шага", "шага", "шагов", "шагов", "шаг"]);
  });
});

// --- прогноз --------------------------------------------------------------------------------

// Активность за дни
const act = (days: { sec: number; steps: number }[], total = { total_sec: 0, total_steps: 0 }): Activity => ({
  // Итоги
  ...total,
  // Дни
  days: days.map((d, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, ...d })),
});

// Группа: прогноз окончания
describe("прогноз: границы", () => {
  // Темп по человеку — с 30 шагов
  it("secPerStep: ровно 30 шагов — свой темп", () => {
    // 30 шагов за 90 с — 3 с на шаг
    expect(secPerStep({ total_sec: 90, total_steps: 30 }, 2)).toBe(3);
    // 29 — скорость из настройки
    expect(secPerStep({ total_sec: 90, total_steps: 29 }, 2)).toBe(2);
  });

  // Ровно минута
  it("duration: 59 с — «1 мин»", () => {
    // Округление до минуты
    expect([duration(29), duration(59), duration(3600)]).toEqual(["меньше минуты", "1 мин", "1 ч"]);
  });

  // Дни меньше минуты не считаются, берутся последние 14
  it("dailyAverageSec: от 60 с, последние 14 дней", () => {
    // 59 с — не день, 60 — день
    expect(dailyAverageSec(act([{ sec: 59, steps: 1 }, { sec: 60, steps: 1 }]))).toBe(60);
    // 15 дней: первый 1000 с, остальные 100 → среднее последних 14 = 100
    expect(dailyAverageSec(act([{ sec: 1000, steps: 1 }, ...Array(14).fill({ sec: 100, steps: 1 })]))).toBe(100);
  });

  // Дата окончания — с 5 минут в день; хватит и одного дня
  it("estimate: один день по 5 минут — дата есть, меньше — нет", () => {
    // Сегодня
    const today = new Date(2026, 10, 1);
    // Один день, 300 с; 300 шагов по 2 с = 600 с → два дня → завтра
    const e = estimate(act([{ sec: 300, steps: 10 }], { total_sec: 300, total_steps: 10 }), 2, 1, 300, today);
    // Завтра
    expect(e.finishDate).toEqual(new Date(2026, 10, 2));
    // Темп не измерен (10 < 30)
    expect(e.measured).toBe(false);
    // 299 с в день — без даты
    expect(estimate(act([{ sec: 299, steps: 10 }]), 2, 1, 300, today).finishDate).toBeNull();
    // Ровно 30 шагов — темп измерен
    expect(estimate(act([], { total_sec: 60, total_steps: 30 }), 2, 1, 300, today).measured).toBe(true);
  });

  // Текст даты
  it("finishText: сегодня, завтра, дата", () => {
    // Сегодня
    const today = new Date(2026, 10, 1);
    // Через день, два
    expect([finishText(today, today), finishText(new Date(2026, 10, 2), today)]).toEqual(["сегодня", "завтра"]);
    // Через два дня — день недели и дата
    expect(finishText(new Date(2026, 10, 3), today)).toMatch(/3 ноября/);
  });
});

// --- обновления -----------------------------------------------------------------------------

// Группа: проверка обновлений
describe("обновления: точные значения", () => {
  // Чистое хранилище
  afterEach(() => localStorage.clear());

  // Многозначные номера
  it("parseVersion и isNewer", () => {
    // Двузначные части
    expect(parseVersion("версия 10.20.30")).toEqual([10, 20, 30]);
    // Новее по сборке
    expect([isNewer("1.4.10", "1.4.9"), isNewer("1.4.9", "1.4.10"), isNewer("1.4.9", "1.4.9")]).toEqual([true, false, false]);
  });

  // Релиз без версии или без файлов
  it("releaseFromGithub: без версии — null, без файлов — страница релиза", () => {
    // Без версии
    expect(releaseFromGithub({ name: "без версии" })).toBeNull();
    // Без файлов
    expect(releaseFromGithub({ name: "1.4.20" })).toEqual({ version: "1.4.20", url: RELEASE_PAGE });
    // Адрес страницы
    expect(RELEASE_PAGE).toBe("https://github.com/alzhelez/string_art/releases/tag/desktop-latest");
  });

  // Кэш ровно 6 часов, заголовок запроса, ошибка GitHub
  it("latestRelease: кэш до 6 ч, заголовок Accept, ошибка — null", async () => {
    // Ответ GitHub
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ name: "1.4.20" })));
    // Первый запрос
    await latestRelease(1_000_000, fetcher as unknown as typeof fetch);
    // Адрес и заголовок
    expect(fetcher).toHaveBeenCalledWith(RELEASE_API, { headers: { Accept: "application/vnd.github+json" } });
    // Кэш под своим ключом
    expect(JSON.parse(localStorage.getItem("stringart.update")!).at).toBe(1_000_000);
    // Через 6 ч без 1 мс — из кэша
    await latestRelease(1_000_000 + 6 * 3_600_000 - 1, fetcher as unknown as typeof fetch);
    // Запрос был один
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Ровно через 6 ч — новый запрос
    await latestRelease(1_000_000 + 6 * 3_600_000, fetcher as unknown as typeof fetch);
    // Два
    expect(fetcher).toHaveBeenCalledTimes(2);
    // Ошибка GitHub (лимит) — null
    localStorage.clear();
    // Ответ 403
    expect(await latestRelease(0, (async () => new Response("", { status: 403 })) as unknown as typeof fetch)).toBeNull();
  });

  // «Позже» — под своим ключом
  it("dismiss: ключ stringart.update.dismissed", () => {
    // Откладываем
    dismiss("1.4.20");
    // Ключ
    expect(localStorage.getItem("stringart.update.dismissed")).toBe("1.4.20");
    // Отложено
    expect([isDismissed("1.4.20"), isDismissed("1.4.21")]).toEqual([true, false]);
  });
});

// --- слои -----------------------------------------------------------------------------------

// Группа: слои портрета
describe("слои: одна нить", () => {
  // Портрет из одной нити
  const mono = { line_count: 1000, current_step: 5, stats: {}, sequence: [0, 120], layers: [] } as unknown as Project;

  // Слой одной нити — чёрный
  it("projectLayers: ключ и название", () => {
    // Слой
    const [l] = projectLayers(mono);
    // Ключ, название, цвет
    expect([l.color, (l as unknown as { key: string }).key, l.name]).toEqual(["black", "black", "Чёрная"]);
  });

  // Один слой в списке — всё равно «Чёрная нить»
  it("layerTitle: один слой — «Чёрная нить»", () => {
    // Портрет с одним слоем в списке
    const single = { layers: [{ name: "Красная" }] } as unknown as ProjectSummary;
    // Подпись
    expect(layerTitle(single, 0)).toBe("Чёрная нить");
  });
});
