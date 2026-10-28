// Цветные портреты на фронтенде: слои, рисование, выбор нитей, цветной кадр, запросы API

// Отрисовка, события, поиск, поиск внутри блока
import { fireEvent, render, screen, within } from "@testing-library/react";
// Описание тестов, хуки, проверки, подмены
import { afterEach, describe, expect, it, vi } from "vitest";
// Выбор нитей и его помощники
import { previewBoard, threadChoiceValid, ThreadPicker } from "@/components/ThreadPicker";
// API-клиент, выбор по умолчанию и типы
import { api, MONO_CHOICE, type Palette, type Project, type ThreadChoice } from "@/lib/api";
// Рисование схемы
import { drawBoard } from "@/lib/draw";
// Слои проекта
import { boardColor, drawColor, drawLayers, isMultiLayer, layerCount, layerTitle, projectLayers } from "@/lib/layers";
// Цветной кадр и перевод HEX
import { DEFAULT_PREP, hexRgb, levelBounds, processColor } from "@/lib/prep";

// Каталог, как его отдаёт сервер (сокращённый)
const PALETTE: Palette = {
  // Режимы
  modes: ["mono", "bw", "color"],
  // Нити
  threads: [
    // Чёрная
    { key: "black", name: "Чёрная", hex: "#1b1b1b" },
    // Белая
    { key: "white", name: "Белая", hex: "#f5f5f0" },
    // Красная
    { key: "red", name: "Красная", hex: "#c0262d" },
    // Синяя
    { key: "blue", name: "Синяя", hex: "#2457a6" },
    // Жёлтая
    { key: "yellow", name: "Жёлтая", hex: "#f0c419" },
    // Зелёная
    { key: "green", name: "Зелёная", hex: "#2f7d3a" },
  ],
  // Доски
  boards: [
    // Белая
    { key: "white", name: "Белая", hex: "#ffffff" },
    // Серая
    { key: "gray", name: "Серая", hex: "#9a9a9a" },
    // Тёмно-синяя
    { key: "navy", name: "Тёмно-синяя", hex: "#2b3a55" },
  ],
  // Доска по умолчанию
  default_board: { mono: "white", bw: "gray", color: "white" },
  // Ограничения числа цветов
  colors: { min: 2, max: 4, default: 3 },
  // Наименьшее число линий слоя
  layer_min_lines: 100,
};

// Расчёт лески-заглушка (содержимое в этих тестах не важно)
const STATS = { steps: 2, diameter_cm: 50, raw_length_m: 1, margin: 0.15, total_length_m: 1.2, spool_m: 100, spool_count: 1, nail_spacing_mm: 6.54 };

// Проект из одной нити (как от старого сервера — без слоёв)
const MONO = {
  // id
  id: "abcabcabcabc",
  // Название
  name: "Одна нить",
  // Число линий
  line_count: 2,
  // Шаг
  current_step: 1,
  // Гвозди
  sequence: [0, 120, 30],
  // Леска
  stats: STATS,
  // Остальные поля проекту для тестов не нужны — приводим тип
} as unknown as Project;

// Портрет из двух нитей на тёмно-синей доске
const BW = {
  // Всё как у одной нити
  ...MONO,
  // Режим
  mode: "bw",
  // Доска
  board: { key: "navy", name: "Тёмно-синяя", hex: "#2b3a55" },
  // Текущая нить
  current_layer: 1,
  // Нити
  layers: [
    // Белая
    { index: 0, color: "white", key: "white", name: "Белая", hex: "#f5f5f0", line_count: 2, current_step: 2, stats: STATS, sequence: [0, 120, 30] },
    // Чёрная
    { index: 1, color: "black", key: "black", name: "Чёрная", hex: "#1b1b1b", line_count: 1, current_step: 1, stats: STATS, sequence: [0, 60] },
  ],
  // Приводим тип
} as unknown as Project;

// Подделка canvas, которая запоминает цвет каждой проведённой линии
function colorContext() {
  // Цвета обводок по порядку
  const strokes: string[] = [];
  // Текущий цвет линии
  let stroke = "";
  // Пустая функция для остальных методов
  const noop = () => undefined;
  // Контекст
  return {
    // Список цветов (тест читает)
    strokes,
    // Цвет заливки (запоминаем последний — проверка доски)
    fills: [] as string[],
    // Чтение цвета линии
    get strokeStyle() {
      // Текущий
      return stroke;
    },
    // Запись цвета линии
    set strokeStyle(v: string) {
      // Запоминаем
      stroke = v;
    },
    // Запись цвета заливки — запоминаем по порядку
    set fillStyle(v: string) {
      // В список
      this.fills.push(v);
    },
    // Обводка — записываем текущий цвет
    stroke() {
      // В список
      strokes.push(stroke);
    },
    // Остальные свойства, которые выставляет drawBoard
    globalAlpha: 1,
    // Толщина
    lineWidth: 1,
    // Шрифт
    font: "",
    // Выравнивание
    textAlign: "",
    // Базовая линия
    textBaseline: "",
    // Концы линий
    lineCap: "",
    // Методы без проверки
    clearRect: noop,
    // Фигура
    beginPath: noop,
    // Дуга
    arc: noop,
    // Заливка
    fill: noop,
    // Перо
    moveTo: noop,
    // Линия
    lineTo: noop,
    // Сохранение
    save: noop,
    // Восстановление
    restore: noop,
    // Пунктир
    setLineDash: noop,
    // Текст
    fillText: noop,
  };
}

// Группа: слои проекта
describe("слои проекта", () => {
  // Старый проект без слоёв — одна чёрная нить из основных полей
  it("одна нить: единственный слой, чистый чёрный цвет", () => {
    // Один слой
    expect(layerCount(MONO)).toBe(1);
    // Не цветной
    expect(isMultiLayer(MONO)).toBe(false);
    // Слой из основных полей
    expect(projectLayers(MONO)[0]).toMatchObject({ color: "black", line_count: 2, sequence: [0, 120, 30] });
    // Рисуется эталонной чёрной леской
    expect(drawLayers(MONO)).toEqual([{ sequence: [0, 120, 30], lines: 2, color: "#000000" }]);
    // Доска белая
    expect(boardColor(MONO)).toBe("#ffffff");
    // Подпись без номера
    expect(layerTitle(MONO, 0)).toBe("Чёрная нить");
  });

  // Две нити: цвета из каталога, доска, подписи, замена числа линий
  it("две нити: свои цвета, доска и подписи", () => {
    // Два слоя
    expect(layerCount(BW)).toBe(2);
    // Цветной
    expect(isMultiLayer(BW)).toBe(true);
    // Цвет нити — из каталога
    expect(drawColor(BW, BW.layers![1])).toBe("#1b1b1b");
    // Замена числа линий у второй нити
    expect(drawLayers(BW, { 1: 1 }).map((l) => l.lines)).toEqual([2, 1]);
    // Доска
    expect(boardColor(BW)).toBe("#2b3a55");
    // Подпись
    expect(layerTitle(BW, 0)).toBe("Нить 1 из 2: белая");
  });
});

// Группа: рисование нескольких нитей
describe("drawBoard с нитями", () => {
  // Студия: все нити целиком своими цветами, доска своего цвета
  it("студия: все нити по порядку и своими цветами", () => {
    // Подделка
    const ctx = colorContext();
    // Рисуем
    drawBoard(ctx as unknown as CanvasRenderingContext2D, { sequence: [0, 120, 30], lines: 2, diameterCm: 50, size: 200, layers: drawLayers(BW), boardColor: "#2b3a55" });
    // Две белые линии, затем одна чёрная
    expect(ctx.strokes).toEqual(["#f5f5f0", "#f5f5f0", "#1b1b1b"]);
    // Первой заливается доска
    expect(ctx.fills[0]).toBe("#2b3a55");
  });

  // Плетение: прежние нити целиком, текущая — до шага, следующие — нет
  it("плетение: прежняя нить целиком, текущая до шага, следующей нет", () => {
    // Подделка
    const ctx = colorContext();
    // Плетём первую нить, шаг 2 (натянута одна линия) — чёрной ещё не должно быть
    drawBoard(ctx as unknown as CanvasRenderingContext2D, { sequence: [0, 120, 30], lines: 2, diameterCm: 50, size: 200, layers: drawLayers(BW), activeLayer: 0, activeStep: 2 });
    // Одна белая линия и подсветка текущего шага (цвет акцента)
    expect(ctx.strokes.slice(0, 1)).toEqual(["#f5f5f0"]);
    // Чёрная не рисовалась
    expect(ctx.strokes).not.toContain("#1b1b1b");
    // Вторая нить: белая целиком (2 линии), чёрная на шаге 1 — без натянутых
    const second = colorContext();
    // Рисуем
    drawBoard(second as unknown as CanvasRenderingContext2D, { sequence: [0, 60], lines: 1, diameterCm: 50, size: 200, layers: drawLayers(BW), activeLayer: 1, activeStep: 1 });
    // Две белые, чёрных ещё нет (кроме подсветки шага другим цветом)
    expect(second.strokes.filter((c) => c === "#f5f5f0")).toHaveLength(2);
    // Чёрных нет
    expect(second.strokes).not.toContain("#1b1b1b");
  });
});

// Группа: выбор нитей
describe("ThreadPicker", () => {
  // Помощник: рисует выбор с шпионом
  function setup(value: ThreadChoice = MONO_CHOICE) {
    // Шпион
    const onChange = vi.fn();
    // Рисуем
    const utils = render(<ThreadPicker palette={PALETTE} value={value} onChange={onChange} />);
    // Отдаём шпион и перерисовку
    return { onChange, ...utils };
  }

  // Без каталога (старый сервер) выбора нет
  it("без каталога ничего не показывает", () => {
    // Рисуем без каталога
    const { container } = render(<ThreadPicker palette={null} value={MONO_CHOICE} onChange={() => undefined} />);
    // Пусто
    expect(container).toBeEmptyDOMElement();
  });

  // Смена режима сбрасывает доску и цвета
  it("режимы: доска и цвета сбрасываются", () => {
    // Рисуем цветной режим с выбранными цветами
    const { onChange } = setup({ mode: "color", colors: ["red", "black"], color_count: 3, board: "gray" });
    // «Чёрная + белая»
    fireEvent.click(screen.getByRole("radio", { name: "Чёрная + белая" }));
    // Новый режим без доски и цветов
    expect(onChange).toHaveBeenLastCalledWith({ mode: "bw", colors: null, color_count: 3, board: null });
  });

  // Одна нить — без доски и цветов
  it("одна нить: ни доски, ни цветов", () => {
    // Рисуем
    setup();
    // Нет выбора доски
    expect(screen.queryByRole("radiogroup", { name: "Доска" })).toBeNull();
    // Режим отмечен
    expect(screen.getByRole("radio", { name: "Одна чёрная" })).toHaveAttribute("aria-checked", "true");
  });

  // Чёрная + белая: доска по умолчанию серая, выбор доски
  it("чёрная + белая: доска по умолчанию серая, можно выбрать", () => {
    // Рисуем
    const { onChange } = setup({ ...MONO_CHOICE, mode: "bw" });
    // Группа досок
    const boards = screen.getByRole("radiogroup", { name: "Доска" });
    // Серая отмечена по умолчанию
    expect(within(boards).getByRole("radio", { name: "Серая" })).toHaveAttribute("aria-checked", "true");
    // Выбираем тёмно-синюю
    fireEvent.click(within(boards).getByRole("radio", { name: "Тёмно-синяя" }));
    // Сообщили
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ board: "navy" }));
    // Белой нити среди цветов нет — это не цветной режим
    expect(screen.queryByRole("button", { name: "Белая" })).toBeNull();
  });

  // Цветной режим: число цветов и ручной выбор
  it("цветные: число цветов, ручной выбор не больше 4, белой нет", () => {
    // Рисуем
    const { onChange, rerender } = setup({ ...MONO_CHOICE, mode: "color" });
    // Выбираем 4 цвета
    fireEvent.click(screen.getByRole("radio", { name: "4" }));
    // Сообщили
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ color_count: 4 }));
    // Белой нити среди цветов нет
    expect(screen.queryByRole("button", { name: "Белая" })).toBeNull();
    // Нажимаем красную
    fireEvent.click(screen.getByRole("button", { name: "Красная" }));
    // Выбрана одна красная
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ colors: ["red"] }));
    // Перерисовываем с одним цветом — подсказка «выберите ещё»
    rerender(<ThreadPicker palette={PALETTE} value={{ ...MONO_CHOICE, mode: "color", colors: ["red"] }} onChange={onChange} />);
    // Предупреждение
    expect(screen.getByRole("alert")).toHaveTextContent("Выберите ещё хотя бы 1 цвет");
    // Число цветов скрыто, пока выбор ручной
    expect(screen.queryByRole("radio", { name: "4" })).toBeNull();
    // Снимаем красную — назад к подбору
    fireEvent.click(screen.getByRole("button", { name: "Красная" }));
    // colors: null
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ colors: null }));
    // Перерисовываем с четырьмя цветами
    rerender(<ThreadPicker palette={PALETTE} value={{ ...MONO_CHOICE, mode: "color", colors: ["red", "blue", "black", "yellow"] }} onChange={onChange} />);
    // Пятый недоступен
    expect(screen.getByRole("button", { name: "Зелёная" })).toBeDisabled();
    // Выбранный можно снять
    expect(screen.getByRole("button", { name: "Красная" })).toHaveAttribute("aria-pressed", "true");
  });

  // Проверка выбора и доска для превью
  it("проверка выбора и цвет доски для превью", () => {
    // Один цвет вручную — нельзя
    expect(threadChoiceValid({ ...MONO_CHOICE, mode: "color", colors: ["red"] }, PALETTE)).toBe(false);
    // Два — можно
    expect(threadChoiceValid({ ...MONO_CHOICE, mode: "color", colors: ["red", "black"] }, PALETTE)).toBe(true);
    // Подбор — можно
    expect(threadChoiceValid({ ...MONO_CHOICE, mode: "color" }, PALETTE)).toBe(true);
    // Одна нить — превью серое
    expect(previewBoard(MONO_CHOICE, PALETTE)).toBeNull();
    // Чёрная + белая — серая доска по умолчанию
    expect(previewBoard({ ...MONO_CHOICE, mode: "bw" }, PALETTE)).toBe("#9a9a9a");
    // Выбранная доска
    expect(previewBoard({ ...MONO_CHOICE, mode: "bw", board: "navy" }, PALETTE)).toBe("#2b3a55");
  });
});

// Группа: цветной кадр
describe("processColor", () => {
  // HEX → RGB
  it("hexRgb", () => {
    // Тёмно-синий
    expect(hexRgb("#2b3a55")).toEqual([43, 58, 85]);
  });

  // Фон под маской становится цветом доски, цвет человека сохраняется
  it("фон — цвет доски, цвет человека не меняется", () => {
    // Два пикселя: красный (человек) и зелёный (фон); оба в разных яркостях, чтобы автоуровни были без растяжения
    const rgba = [255, 0, 0, 255, 0, 255, 0, 255];
    // Маска: первый — человек, второй — фон
    const out = processColor(rgba, { ...DEFAULT_PREP, remove_background: true }, [255, 0], [43, 58, 85]);
    // Второй пиксель — цвет доски
    expect(Array.from(out.slice(4, 7))).toEqual([43, 58, 85]);
    // Первый пиксель — красный (красный канал самый яркий)
    expect(out[0]).toBeGreaterThan(out[1]);
    // Непрозрачный
    expect(out[3]).toBe(255);
  });

  // Однотонный кадр не растягивается
  it("однотонный кадр: автоуровни ничего не делают", () => {
    // Границ нет
    expect(levelBounds(new Float32Array([90, 90, 90]))).toBeNull();
    // Цвет не изменился
    expect(Array.from(processColor([90, 90, 90, 255], DEFAULT_PREP, null, [255, 255, 255]).slice(0, 3))).toEqual([90, 90, 90]);
  });
});

// Группа: запросы API
describe("api: нити и слои", () => {
  // После каждого теста — настоящий fetch
  afterEach(() => vi.unstubAllGlobals());

  // Создание из фото: поля нитей отдельно, цвета только в цветном режиме
  it("createFromImage передаёт режим, цвета и доску", async () => {
    // Шпион fetch
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    // Ставим
    vi.stubGlobal("fetch", fetchMock);
    // Чёрная + белая с цветами (они не должны уйти — режим не цветной)
    await api.createFromImage({ image_id: "abcabcabcabc", name: "x", diameter_cm: 50, prep: DEFAULT_PREP, threads: { mode: "bw", colors: ["red"], color_count: 3, board: "navy" } });
    // Тело
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    // Поля нитей
    expect(body).toMatchObject({ mode: "bw", colors: null, color_count: 3, board: "navy", name: "x" });
    // Поля threads в теле нет
    expect(body.threads).toBeUndefined();
  });

  // Правка фото и сходство слоя
  it("updatePhoto с нитями и similarity для второй нити", async () => {
    // Шпион fetch
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    // Ставим
    vi.stubGlobal("fetch", fetchMock);
    // Правка фото со сменой на цветной режим
    await api.updatePhoto("abcabcabcabc", DEFAULT_PREP, { mode: "color", colors: ["red", "black"], color_count: 2, board: null });
    // Тело — кадр и нити вместе
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    // Проверка
    expect(body).toMatchObject({ zoom: 1, mode: "color", colors: ["red", "black"] });
    // Сходство второй нити
    await api.similarity("abcabcabcabc", 50, 1);
    // Адрес с layer
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toBe("/api/projects/abcabcabcabc/similarity?diameter_cm=50&layer=1");
    // Палитра из настроек
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ palette: PALETTE })));
    // Запрос
    expect(await api.palette()).toEqual(PALETTE);
  });
});
