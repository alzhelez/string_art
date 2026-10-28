// act, события, отрисовка компонентов и хуков, поиск
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
// Описание тестов, хуки, проверки, подмены
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Окно кадра редактора фото
import { PhotoViewport } from "@/components/PhotoEditor";
// Вкладки и переключатель
import { Switch, Tabs } from "@/components/ui/Controls";
// Панель времени в плетении
import { TimePanel } from "@/components/weave/TimePanel";
// Хук отложенного сохранения
import { useDebouncedPatch } from "@/hooks/useDebouncedPatch";
// API-клиент, его ошибка и тип картинки
import { api, ApiError, type ImageInfo } from "@/lib/api";
// Рисование схемы на canvas
import { drawBoard } from "@/lib/draw";
// Тип прогноза
import type { Eta } from "@/lib/eta";
// Уменьшение фото
import { downscaleImage, scaledSize } from "@/lib/image";
// Параметры кадра и рисование подготовленного кадра
import { DEFAULT_PREP, drawPrepared, type Prep } from "@/lib/prep";
// Скачивание файла и выбор формата видео
import { saveBlob, videoFormat } from "@/lib/share";

/** Контекст canvas, который записывает вызовы — jsdom сам рисовать не умеет. */
// Помощник: подделка контекста canvas
function recordingContext() {
  // Список вызовов: имя и аргументы
  const calls: { name: string; args: unknown[] }[] = [];
  // Фабрика функций-записывателей
  const record =
    // по имени метода
    (name: string) =>
    // возвращает функцию, которая
    (...args: unknown[]) => {
      // запоминает вызов
      calls.push({ name, args });
    };
  // Контекст:
  const ctx = {
    // список вызовов, чтобы тест его прочитал
    calls,
    // ссылка на canvas
    canvas: null,
    // прозрачность
    globalAlpha: 1,
    // толщина линии
    lineWidth: 1,
    // цвет заливки
    fillStyle: "",
    // цвет линии
    strokeStyle: "",
    // шрифт
    font: "",
    // выравнивание текста
    textAlign: "",
    // базовая линия текста
    textBaseline: "",
    // концы линий
    lineCap: "",
    // сглаживание
    imageSmoothingEnabled: false,
    // качество сглаживания
    imageSmoothingQuality: "",
    // методы рисования только записывают вызовы:
    clearRect: record("clearRect"),
    // заливка прямоугольника
    fillRect: record("fillRect"),
    // начало фигуры
    beginPath: record("beginPath"),
    // дуга
    arc: record("arc"),
    // заливка
    fill: record("fill"),
    // перемещение пера
    moveTo: record("moveTo"),
    // линия
    lineTo: record("lineTo"),
    // обводка
    stroke: record("stroke"),
    // сохранение состояния
    save: record("save"),
    // восстановление
    restore: record("restore"),
    // пунктир
    setLineDash: record("setLineDash"),
    // текст
    fillText: record("fillText"),
    // картинка
    drawImage: record("drawImage"),
    // запись пикселей
    putImageData: record("putImageData"),
    // Серый пиксель (R=G=B=100) — так автоуровни сделают однотонную картинку
    // чтение пикселей
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(100) }),
    // создание пустого буфера пикселей
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  };
  // Отдаём подделку
  return ctx;
}

// Группа: API-клиент
describe("api-клиент: все ветки разбора ответа", () => {
  // После каждого теста — настоящий fetch
  afterEach(() => vi.unstubAllGlobals());

  // Ошибка проверки FastAPI приходит списком
  it("ошибка проверки данных FastAPI (detail — список) → текст первой ошибки", async () => {
    // fetch отвечает 422 со списком
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: [{ msg: "Input should be ≥ 20" }] }), { status: 422 })));
    // Текст — из первой ошибки
    await expect(api.update("abcabcabcabc", { diameter_cm: 10 })).rejects.toMatchObject({ status: 422, message: "Input should be ≥ 20" });
  });

  // Ответ не JSON
  it("тело ошибки не JSON → «Ошибка 500»", async () => {
    // fetch отвечает текстом
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Internal Server Error", { status: 500 })));
    // Ошибка с номером
    await expect(api.list()).rejects.toMatchObject({ status: 500, message: "Ошибка 500" });
  });

  // Ответ 204 без тела
  it("204 → undefined без разбора тела", async () => {
    // fetch отвечает 204
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    // Результат — undefined
    await expect(api.remove("abcabcabcabc")).resolves.toBeUndefined();
  });

  // Неправильный id не отправляется
  it("кривой id даже не уходит на сервер", async () => {
    // Шпион fetch
    const fetchMock = vi.fn();
    // Ставим
    vi.stubGlobal("fetch", fetchMock);
    // Пытаемся открыть «../etc»
    const err = await api.get("../etc").catch((e) => e);
    // Наша ошибка
    expect(err).toBeInstanceOf(ApiError);
    // Как будто «не найдено»
    expect(err.status).toBe(404);
    // На сервер не ходили
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Создание проекта: форма
  it("create: название обрезается, пустое не отправляется; диаметр — строкой", async () => {
    // Шпион fetch
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    // Ставим
    vi.stubGlobal("fetch", fetchMock);
    // Название с пробелами по краям
    await api.create(new Blob(["x"]), "a.jpg", "  Мама  ", 70);
    // Тело первого запроса
    let form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    // Пробелы обрезаны
    expect(form.get("name")).toBe("Мама");
    // Диаметр строкой — так требует форма
    expect(form.get("diameter_cm")).toBe("70");
    // Название из одних пробелов
    await api.create(new Blob(["x"]), "a.jpg", "   ", 50);
    // Тело второго запроса
    form = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as FormData;
    // Поля названия нет
    expect(form.has("name")).toBe(false);
  });

  // Создание из фото: пустое название
  it("createFromImage: пустое название → null (сервер подставит дату)", async () => {
    // Шпион
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    // Ставим
    vi.stubGlobal("fetch", fetchMock);
    // Название из пробелов
    await api.createFromImage({ image_id: "abcabcabcabc", name: "  ", diameter_cm: 50, prep: DEFAULT_PREP });
    // Тело запроса
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    // Название — null
    expect(body.name).toBeNull();
    // Параметры кадра переданы
    expect(body.prep).toEqual(DEFAULT_PREP);
  });

  // Адреса запросов
  it("адреса: сходство с диаметром и без, превью, шаблон", () => {
    // Шпион
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    // Ставим
    vi.stubGlobal("fetch", fetchMock);
    // Сходство для 30 см
    void api.similarity("p1", 30);
    // Сходство без диаметра
    void api.similarity("p1");
    // Адреса запросов:
    expect(fetchMock.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([
      // с диаметром
      "/api/projects/p1/similarity?diameter_cm=30",
      // без
      "/api/projects/p1/similarity",
    ]);
    // Превью
    expect(api.previewUrl("p1", 320)).toBe("/api/projects/p1/preview.png?size=320");
    // Превью для конкретного числа нитей
    expect(api.previewUrl("p1", 320, 1500)).toBe("/api/projects/p1/preview.png?size=320&lines=1500");
    // Шаблон A4 по умолчанию
    expect(api.templateUrl("p1")).toBe("/api/projects/p1/template.pdf?paper=A4");
    // Шаблон A3
    expect(api.templateUrl("p1", "A3")).toBe("/api/projects/p1/template.pdf?paper=A3");
  });
});

// Группа: рисование на canvas
describe("рисование на canvas", () => {
  // Схема в студии и в плетении
  it("drawBoard: одна линия — один stroke; в плетении текущий шаг выделен и подписан", () => {
    // Подделка контекста
    const ctx = recordingContext();
    // Короткая схема
    const sequence = [0, 120, 30, 150];
    // Рисуем 3 нити
    drawBoard(ctx as unknown as CanvasRenderingContext2D, { sequence, lines: 3, diameterCm: 50, size: 400 });
    // Три обводки — по одной на нить
    expect(ctx.calls.filter((c) => c.name === "stroke")).toHaveLength(3);
    // Без режима плетения текст не рисуется
    expect(ctx.calls.some((c) => c.name === "fillText")).toBe(false); // без режима плетения подписей нет

    // Подделка для режима плетения
    const weave = recordingContext();
    // Рисуем с текущим шагом 2
    drawBoard(weave as unknown as CanvasRenderingContext2D, { sequence, lines: 3, diameterCm: 50, size: 400, activeStep: 2 });
    // Все нарисованные тексты
    const texts = weave.calls.filter((c) => c.name === "fillText").map((c) => c.args[0]);
    // Буквы секторов и метки «откуда» (C1 = 120) и «куда» (A31 = 30)
    // Есть буквы секторов и подписи концов текущей нити
    expect(texts).toEqual(expect.arrayContaining(["A", "B", "C", "D", "C1", "A31"]));
  });

  // Подготовленный кадр
  it("drawPrepared: без canvas возвращает false, с canvas — рисует серый кадр", () => {
    // Картинка 200×100
    const image = { width: 200, height: 100 } as unknown as HTMLImageElement;
    // canvas
    const target = document.createElement("canvas");
    // В jsdom нет контекста — функция честно отвечает false
    expect(drawPrepared(target, image, null, DEFAULT_PREP)).toBe(false);

    // Подменяем контекст записывающей подделкой
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => recordingContext() as never);
    // Блок с восстановлением
    try {
      // Рисуем в квадрат 8 px
      expect(drawPrepared(target, image, null, DEFAULT_PREP, 8)).toBe(true);
      // Размер canvas выставлен
      expect(target.width).toBe(8);
    // В любом случае —
    } finally {
      // — возвращаем настоящий getContext
      spy.mockRestore();
    }
  });
});

// Группа: файлы
describe("файлы", () => {
  // После каждого теста — настоящие глобальные объекты
  afterEach(() => vi.unstubAllGlobals());

  // Уменьшение размеров
  it("scaledSize не увеличивает маленькие фото и сохраняет пропорции", () => {
    // Маленькое не увеличивается
    expect(scaledSize(800, 600)).toEqual([800, 600]);
    // Большое — до 1600
    expect(scaledSize(4000, 3000)).toEqual([1600, 1200]);
    // Свой предел 100, вертикальное фото
    expect(scaledSize(3000, 4000, 100)).toEqual([75, 100]);
  });

  // Без createImageBitmap
  it("downscaleImage без createImageBitmap отдаёт исходный файл", async () => {
    // Убираем функцию
    vi.stubGlobal("createImageBitmap", undefined);
    // Файл
    const f = new File(["x"], "a.jpg", { type: "image/jpeg" });
    // Отдаётся без изменений
    await expect(downscaleImage(f)).resolves.toBe(f);
  });

  // Ошибка декодирования
  it("downscaleImage при ошибке декодирования отдаёт исходный файл", async () => {
    // Функция падает
    vi.stubGlobal("createImageBitmap", vi.fn(async () => Promise.reject(new Error("bad"))));
    // Файл HEIC
    const f = new File(["x"], "a.heic", { type: "image/heic" });
    // Отдаётся без изменений
    await expect(downscaleImage(f)).resolves.toBe(f);
  });

  // Формат видео
  it("videoFormat предпочитает MP4 и откатывается на WebM", () => {
    // Браузер умеет MP4
    vi.stubGlobal("MediaRecorder", { isTypeSupported: (m: string) => m.startsWith("video/mp4") });
    // Выбран MP4
    expect(videoFormat()).toEqual({ mime: "video/mp4;codecs=avc1.42E01E", ext: "mp4" });
    // Умеет только WebM
    vi.stubGlobal("MediaRecorder", { isTypeSupported: (m: string) => m === "video/webm" });
    // Выбран WebM
    expect(videoFormat()).toEqual({ mime: "video/webm", ext: "webm" });
    // Ничего не умеет
    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => false });
    // Формата нет
    expect(videoFormat()).toBeNull();
  });

  // Скачивание файла
  it("saveBlob скачивает файл с нужным именем и убирает ссылку", () => {
    // Искусственное время
    vi.useFakeTimers();
    // Сюда записываем имена скачанных файлов
    const clicks: string[] = [];
    // Подменяем создание и освобождение адреса
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: vi.fn() });
    // Запоминаем настоящий click
    const orig = HTMLAnchorElement.prototype.click;
    // Подменяем клик по ссылке
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      // Записываем имя файла
      clicks.push(this.download);
    };
    // Блок с восстановлением
    try {
      // Скачиваем
      saveBlob(new Blob(["x"]), "Мама — таймлапс.mp4");
      // Имя правильное
      expect(clicks).toEqual(["Мама — таймлапс.mp4"]);
      // Временная ссылка убрана со страницы
      expect(document.querySelectorAll("a")).toHaveLength(0);
      // Через минуту —
      vi.advanceTimersByTime(60_000);
      // — адрес освобождён
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
    // В любом случае —
    } finally {
      // — настоящий click
      HTMLAnchorElement.prototype.click = orig;
      // — настоящее время
      vi.useRealTimers();
    }
  });
});

// Группа: окно кадра
describe("окно кадра: мышь, колесо и клавиатура", () => {
  // Описание картинки 1000×1000
  const info = { id: "img1", width: 1000, height: 1000, faces: [], has_mask: false, face_prep: null } as ImageInfo;
  // Зум 2
  const prep: Prep = { ...DEFAULT_PREP, zoom: 2 };

  // Помощник: рисует окно и подготавливает canvas
  function setup() {
    // Шпион
    const onChange = vi.fn();
    // Рисуем
    render(<PhotoViewport info={info} image={null} mask={null} prep={prep} onChange={onChange} />);
    // canvas окна
    const canvas = screen.getByTestId("photo-viewport");
    // Размер окна на экране — 500×500 (jsdom сам не считает)
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 500, right: 500, bottom: 500, x: 0, y: 0, toJSON: () => ({}) });
    // Захват указателя — в jsdom его нет
    canvas.setPointerCapture = () => undefined;
    // Отдаём шпион и canvas
    return { onChange, canvas };
  }

  // Клавиатура
  it("стрелки сдвигают кадр, плюс и минус меняют масштаб", () => {
    // Рисуем
    const { onChange, canvas } = setup();
    // Стрелка влево
    fireEvent.keyDown(canvas, { key: "ArrowLeft" });
    // Стрелка влево двигает фото вправо → центр кадра левее
    // Центр левее середины
    expect(onChange.mock.calls[0][0].center_x).toBeLessThan(0.5);
    // Плюс
    fireEvent.keyDown(canvas, { key: "+" });
    // Зум ×1,1
    expect(onChange.mock.calls[1][0].zoom).toBeCloseTo(2.2, 5);
    // Минус
    fireEvent.keyDown(canvas, { key: "-" });
    // Зум ÷1,1
    expect(onChange.mock.calls[2][0].zoom).toBeCloseTo(2 / 1.1, 5);
    // Незнакомая клавиша
    fireEvent.keyDown(canvas, { key: "x" });
    // Ничего не изменилось
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  // Перетаскивание
  it("перетаскивание мышью сдвигает кадр на столько же пикселей фото", () => {
    // Рисуем
    const { onChange, canvas } = setup();
    // Нажали
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 250, clientY: 250 });
    // Сдвинули на 50 px вправо
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 300, clientY: 250 });
    // Отпустили
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    // Кадр 500 px фото на 500 px экрана: сдвиг на 50 px → центр левее на 50/1000
    // Одно изменение
    expect(onChange).toHaveBeenCalledTimes(1);
    // Центр 0,45
    expect(onChange.mock.calls[0][0].center_x).toBeCloseTo(0.45, 5);
    // После отпускания движение без нажатия ничего не меняет
    // Двигаем без нажатия
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 400, clientY: 250 });
    // Изменений больше нет
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  // Колесо мыши
  it("колесо мыши: вверх — ближе, вниз — дальше", () => {
    // Рисуем
    const { onChange, canvas } = setup();
    // Вверх
    fireEvent.wheel(canvas, { deltaY: -100 });
    // Вниз
    fireEvent.wheel(canvas, { deltaY: 100 });
    // Ближе
    expect(onChange.mock.calls[0][0].zoom).toBeGreaterThan(2);
    // Дальше
    expect(onChange.mock.calls[1][0].zoom).toBeLessThan(2);
  });
});

// Группа: элементы управления
describe("вкладки, переключатели, время", () => {
  // Вкладки и стрелки
  it("вкладки переключаются стрелками по кругу, и фокус переходит на новую", () => {
    // Шпион
    const onChange = vi.fn();
    // Две вкладки:
    const tabs = [
      // А
      { id: "a", title: "А", panel: <p>панель А</p> },
      // Б
      { id: "b", title: "Б", panel: <p>панель Б</p> },
    ];
    // Рисуем на вкладке А
    const { rerender } = render(<Tabs label="Тест" tabs={tabs} value="a" onChange={onChange} />);
    // Панель Б скрыта
    expect(screen.getByText("панель Б").closest("[role=tabpanel]")).toHaveAttribute("hidden");
    // Стрелка влево с первой вкладки
    fireEvent.keyDown(screen.getByRole("tab", { name: "А" }), { key: "ArrowLeft" });
    // Перешли на последнюю
    expect(onChange).toHaveBeenLastCalledWith("b"); // с первой влево — на последнюю
    // Перерисовываем с выбранной Б
    rerender(<Tabs label="Тест" tabs={tabs} value="b" onChange={onChange} />);
    // Фокус на ней
    expect(screen.getByRole("tab", { name: "Б" })).toHaveFocus();
    // Стрелка вправо с последней
    fireEvent.keyDown(screen.getByRole("tab", { name: "Б" }), { key: "ArrowRight" });
    // Перешли на первую
    expect(onChange).toHaveBeenLastCalledWith("a");
    // Enter — не стрелка
    fireEvent.keyDown(screen.getByRole("tab", { name: "Б" }), { key: "Enter" });
    // Ничего не изменилось
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  // Подсказка-ошибка у переключателя
  it("Switch: подсказка-ошибка читается диктором сразу (role=alert)", () => {
    // Шпион
    const onChange = vi.fn();
    // Рисуем с ролью alert
    render(<Switch label="Убрать фон" checked={false} onChange={onChange} hint="Модель не скачалась" hintRole="alert" />);
    // Подсказка — alert
    expect(screen.getByRole("alert")).toHaveTextContent("Модель не скачалась");
    // Клик
    fireEvent.click(screen.getByRole("switch", { name: "Убрать фон" }));
    // Включено
    expect(onChange).toHaveBeenCalledWith(true);
  });

  // Панель времени
  it("TimePanel: варианты перерыва и пустой журнал", () => {
    // Шпион
    const setBreakMin = vi.fn();
    // Прогноз без своего темпа
    const eta: Eta = { remainingSteps: 2999, remainingSec: 5998, paceSec: 2, measured: false, finishDate: null, dailySec: 0 };
    // Рисуем
    render(<TimePanel eta={eta} activity={{ total_sec: 0, total_steps: 0, days: [] }} breakMin={60} setBreakMin={setBreakMin} />);
    // Даты окончания нет
    expect(screen.getByTestId("eta-date")).toHaveTextContent("—");
    // Объяснено, откуда прогноз
    expect(screen.getByText(/пока по скорости перелистывания/)).toBeInTheDocument();
    // Перерыв каждые 60 минут
    expect(screen.getByRole("radio", { name: "60 мин" })).toHaveAttribute("aria-checked", "true");
    // «Не напоминать»
    fireEvent.click(screen.getByRole("radio", { name: "Не напоминать" }));
    // Передан 0
    expect(setBreakMin).toHaveBeenCalledWith(0);
    // Журнала по дням нет — он пустой
    expect(screen.queryByLabelText("Время плетения по дням")).toBeNull();
  });
});

// Группа: отложенное сохранение
describe("отложенное сохранение", () => {
  // Искусственное время
  beforeEach(() => vi.useFakeTimers());
  // После —
  afterEach(() => {
    // — настоящее время
    vi.useRealTimers();
    // — настоящий fetch
    vi.unstubAllGlobals();
  });

  // Несколько изменений — один запрос
  it("несколько изменений подряд уходят одним PATCH, последнее значение побеждает", async () => {
    // Шпион
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    // Ставим
    vi.stubGlobal("fetch", fetchMock);
    // Хук с задержкой 400 мс
    const { result } = renderHook(() => useDebouncedPatch("abcabcabcabc", 400));
    // Два изменения подряд:
    act(() => {
      // первое
      result.current.schedule({ line_count: 2000 });
      // второе
      result.current.schedule({ line_count: 2100, diameter_cm: 60 });
    });
    // Пока ничего не ушло
    expect(fetchMock).not.toHaveBeenCalled();
    // Через 400 мс —
    await act(async () => {
      // проматываем
      vi.advanceTimersByTime(400);
    });
    // — один запрос
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // С последними значениями:
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({
      // число нитей
      line_count: 2100,
      // диаметр
      diameter_cm: 60,
    });
  });

  // Уход со страницы
  it("при уходе со страницы неотправленное уходит сразу и с keepalive", async () => {
    // Шпион
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    // Ставим
    vi.stubGlobal("fetch", fetchMock);
    // Хук
    const { result, unmount } = renderHook(() => useDebouncedPatch("abcabcabcabc", 400));
    // Изменение
    act(() => result.current.schedule({ current_step: 77 }));
    // Страница закрывается
    unmount();
    // Отправлено сразу
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // С keepalive — запрос переживёт закрытие вкладки
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].keepalive).toBe(true);
  });

  // Ошибка сохранения
  it("ошибка сохранения передаётся в обработчик", async () => {
    // fetch отвечает 503
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Нет связи" }), { status: 503 })));
    // Шпион обработчика ошибок
    const onError = vi.fn();
    // Хук с обработчиком
    const { result } = renderHook(() => useDebouncedPatch("abcabcabcabc", 400, onError));
    // Изменение
    act(() => result.current.schedule({ speed_sec: 3 }));
    // Отправляем сразу
    await act(async () => {
      // flush
      await result.current.flush();
    });
    // Обработчик получил ошибку
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ status: 503, message: "Нет связи" }));
  });
});
