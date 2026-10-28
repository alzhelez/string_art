// Описание тестов, проверки, подмены
import { afterEach, describe, expect, it, vi } from "vitest";
// API-клиент и класс его ошибок
import { api, ApiError } from "@/lib/api";
// Прозрачность одной нити на превью
import { lineAlpha } from "@/lib/draw";
// Форматирование чисел и секунд
import { num, seconds } from "@/lib/format";
// Уменьшение фото с сохранением пропорций
import { scaledSize } from "@/lib/image";
// Озвучка шагов
import { speak, spokenNail, spokenStep } from "@/lib/speech";
// Скорость автоперелистывания
import { canGoFaster, canGoSlower, clampSpeed, faster, slower } from "@/lib/speed";

// Группа: скорость
describe("скорость автоперелистывания", () => {
  // Шаг ±0,1 с без «2,1999999»
  it("по умолчанию шаг 0,1 с без ошибок округления", () => {
    // Начинаем с 2 с
    let s = 2.0;
    // Три раза быстрее
    for (let i = 0; i < 3; i++) s = faster(s);
    // 1,7 ровно
    expect(s).toBe(1.7);
    // Пять раз медленнее
    for (let i = 0; i < 5; i++) s = slower(s);
    // 2,2 ровно
    expect(s).toBe(2.2);
  });

  // Границы 0,5 и 10 с
  it("не выходит за 0,5…10 с", () => {
    // Быстрее минимума нельзя
    expect(faster(0.5)).toBe(0.5);
    // Медленнее максимума нельзя
    expect(slower(10)).toBe(10);
    // Слишком мало — поднимаем до 0,5
    expect(clampSpeed(0.1)).toBe(0.5);
    // Слишком много — опускаем до 10
    expect(clampSpeed(42)).toBe(10);
    // На минимуме кнопка «быстрее» неактивна
    expect(canGoFaster(0.5)).toBe(false);
    // На максимуме «медленнее» неактивна
    expect(canGoSlower(10)).toBe(false);
    // Чуть выше минимума — ещё можно
    expect(canGoFaster(0.6)).toBe(true);
  });
});

// Группа: озвучка
describe("озвучка", () => {
  // Латинские буквы секторов произносятся по-русски
  it("буквы секторов читаются по-русски", () => {
    // A1
    expect(spokenNail(0)).toBe("А 1");
    // B5
    expect(spokenNail(64)).toBe("Бэ 5");
    // C37
    expect(spokenNail(156)).toBe("Цэ 37");
    // D60
    expect(spokenNail(239)).toBe("Дэ 60");
  });

  // Два режима озвучки
  it("режимы «куда» и «откуда и куда»", () => {
    // Только куда
    expect(spokenStep(11, 156, "target")).toBe("Цэ 37");
    // Откуда и куда
    expect(spokenStep(11, 156, "full")).toBe("А 12, Цэ 37");
  });

  // Новая фраза обрывает старую и говорит по-русски
  it("speak() обрывает предыдущую фразу и говорит по-русски", () => {
    // Сюда собираем «произнесённые» фразы
    const spoken: SpeechSynthesisUtterance[] = [];
    // Шпион отмены
    const cancel = vi.fn();
    // Подменяем класс фразы — в jsdom его нет
    vi.stubGlobal("SpeechSynthesisUtterance", class {
      // язык
      lang = "";
      // скорость
      rate = 1;
      // голос
      voice: unknown = null;
      // текст фразы
      constructor(public text: string) {}
    });
    // Подменяем синтезатор речи браузера
    Object.defineProperty(window, "speechSynthesis", {
      // разрешаем потом удалить
      configurable: true,
      // отмена, произнесение, список голосов
      value: { cancel, speak: (u: SpeechSynthesisUtterance) => spoken.push(u), getVoices: () => [] },
    });
    // Говорим
    speak("Цэ 37");
    // Предыдущая фраза оборвана
    expect(cancel).toHaveBeenCalledOnce();
    // Произнесён нужный текст
    expect(spoken[0].text).toBe("Цэ 37");
    // На русском
    expect(spoken[0].lang).toBe("ru-RU");
    // Возвращаем настоящие глобальные объекты
    vi.unstubAllGlobals();
  });
});

// Группа: форматирование
describe("форматирование", () => {
  // Пробел между тысячами и запятая
  it("русские разделители", () => {
    // Число с одним знаком
    expect(num(1176.7, 1)).toBe("1 176,7");
    // Секунды
    expect(seconds(2)).toBe("2,0 с");
  });
});

// Группа: превью
describe("превью", () => {
  // Прозрачность нити зависит от диаметра
  it("на маленьком круге одна линия темнее", () => {
    // На 30 см нить «темнее», чем на 70 см
    expect(lineAlpha(800, 30)).toBeGreaterThan(lineAlpha(800, 70));
    // Для 50 см — 0,32
    expect(lineAlpha(800, 50)).toBeCloseTo(0.32, 5); // 0,2 мм / (500 мм / 800 px)
  });

  // Уменьшение фото
  it("уменьшение фото сохраняет пропорции", () => {
    // Большое уменьшается до 1600 по длинной стороне
    expect(scaledSize(4000, 3000)).toEqual([1600, 1200]);
    // Маленькое не трогается
    expect(scaledSize(800, 600)).toEqual([800, 600]);
  });
});

// Группа: API-клиент
describe("api-клиент", () => {
  // После каждого теста возвращаем настоящий fetch
  afterEach(() => vi.unstubAllGlobals());

  // Текст ошибки берётся из поля detail
  it("достаёт текст ошибки из detail", async () => {
    // fetch отвечает 404 с текстом
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Проект не найден" }), { status: 404 })));
    // Ошибка со статусом и текстом с сервера
    await expect(api.get("000000000000")).rejects.toMatchObject({ status: 404, message: "Проект не найден" });
  });

  // Нет связи с сервером — понятный текст
  it("сетевую ошибку объясняет понятным текстом", async () => {
    // fetch падает, как при выключенном бэкенде
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    // Ловим ошибку
    const err = await api.list().catch((e) => e);
    // Это наш класс ошибки
    expect(err).toBeInstanceOf(ApiError);
    // Статус 0 — ответа не было
    expect(err.status).toBe(0);
    // Текст про бэкенд
    expect(err.message).toMatch(/бэкенд/);
  });

  // Изменение проекта уходит JSON-ом методом PATCH
  it("PATCH отправляет JSON", async () => {
    // Шпион fetch с пустым ответом
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    // Подменяем
    vi.stubGlobal("fetch", fetchMock);
    // Меняем шаг
    await api.update("abcabcabcabc", { current_step: 5 });
    // Аргументы первого вызова fetch
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // Адрес
    expect(url).toBe("/api/projects/abcabcabcabc");
    // Метод
    expect(init.method).toBe("PATCH");
    // Тело
    expect(JSON.parse(String(init.body))).toEqual({ current_step: 5 });
  });
});

// Группа: адреса страниц
describe("routes", () => {
  // Адреса с ?id=, потому что статическая сборка не знает id заранее
  it("адреса страниц проекта — с ?id=, чтобы работала статическая сборка", async () => {
    // Загружаем модуль адресов
    const { routes } = await import("@/lib/routes");
    // Студия
    expect(routes.project("abc123def456")).toBe("/project?id=abc123def456");
    // Плетение
    expect(routes.weave("abc123def456")).toBe("/project/weave?id=abc123def456");
    // Редактор фото; пробел закодирован
    expect(routes.photo("a b")).toBe("/project/photo?id=a%20b");
  });
});
