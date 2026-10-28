// act, события, отрисовка, поиск, поиск внутри блока
import { act, fireEvent, render, screen, within } from "@testing-library/react";
// Описание тестов, хуки, проверки, подмены
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// План смены катушек в студии
import { SpoolPlanner } from "@/components/studio/SpoolPlanner";
// Сцена студии: схема, сравнение с фото, вид на стене
import { StageView } from "@/components/studio/StageView";
// Уведомление о новой версии программы
import { UpdateNotice } from "@/components/UpdateNotice";
// Проигрыватель шагов
import { WeavePlayer } from "@/components/WeavePlayer";
// Тип учёта времени
import type { Activity } from "@/lib/api";
// Распознавание клавиш кликера и голосовых команд
import { keyCommand, voiceCommand } from "@/lib/control";
// Прогноз окончания работы
import { dailyAverageSec, duration, estimate, finishText, localDay, secPerStep } from "@/lib/eta";
// Склонение слов после чисел
import { plural } from "@/lib/format";
// Кадры таймлапса и выбор формата видео
import { linesAtFrame, videoFormat } from "@/lib/share";
// Расчёт смен катушки
import { nextChange, planSpools } from "@/lib/spool";
// Накопленная длина лески
import { cumulativeLengthsM } from "@/lib/thread";
// Проверка обновлений через GitHub
import { isNewer, latestRelease, parseVersion, releaseFromGithub } from "@/lib/update";

// Перед каждым тестом очищаем localStorage
beforeEach(() => localStorage.clear());

/** Длинная «настоящая» последовательность: прыжки через полкруга с дрейфом. */
// 3001 гвоздь: шаг 113 по кругу из 240
const LONG = Array.from({ length: 3001 }, (_, i) => (i * 113) % 240);
// Пустой учёт времени
const EMPTY: Activity = { total_sec: 0, total_steps: 0, days: [] };

// Группа: план смены катушки
describe("план смены катушки", () => {
  // Длинной катушки хватает на всё
  it("хватает одной катушки — смен нет", () => {
    // Катушка 100 км — смен нет, одна катушка
    expect(planSpools(LONG, 3000, 50, 100_000)).toEqual({ changes: [], spools: 1 });
  });

  // Катушка 300 м — несколько смен
  it("маленькая катушка: смены по порядку, ни одна катушка не перерасходована", () => {
    // План смен
    const { changes, spools } = planSpools(LONG, 3000, 50, 300);
    // Чистая длина лески после каждого шага
    const raw = cumulativeLengthsM(LONG, 50);
    // Катушек на одну больше, чем смен
    expect(spools).toBe(changes.length + 1);
    // Смен больше двух
    expect(changes.length).toBeGreaterThan(2);
    // Начало текущей катушки
    let start = 0;
    // Для каждой смены —
    for (const c of changes) {
      // — она позже начала катушки
      expect(c.afterStep).toBeGreaterThan(start);
      // — на катушку ушло не больше 300 м с запасом 15 % и полуметром на узел
      expect((raw[c.afterStep] - raw[start]) * 1.15).toBeLessThanOrEqual(300 - 0.5 + 1e-9);
      // узел — не раньше последних 3 % катушки (не тратим леску зря)
      // — но и не слишком рано
      expect((raw[c.afterStep] - raw[start]) * 1.15).toBeGreaterThan(300 * 0.9);
      // — место смены подписано гвоздём
      expect(c.label).toMatch(/^[ABCD]\d{1,2}$/);
      // Следующая катушка начинается здесь
      start = c.afterStep;
    }
    // Последней катушки хватает до конца
    expect((raw[3000] - raw[start]) * 1.15).toBeLessThanOrEqual(300);
    // Ближайшая смена от начала — первая
    expect(nextChange(changes, 1)).toBe(changes[0]);
    // После первой — вторая
    expect(nextChange(changes, changes[0].afterStep + 1)).toBe(changes[1]);
    // После конца смен нет
    expect(nextChange(changes, 3000)).toBeNull();
  });

  // Узел лучше завязывать на «популярном» гвозде
  it("узел — на гвозде, через который проходит больше нитей", () => {
    // гвоздь 7 встречается очень часто — среди равных по длине вариантов выбираем его
    // Через гвоздь 7 проходит каждая вторая нить
    const seq = Array.from({ length: 2001 }, (_, i) => (i % 2 === 0 ? 7 : (i * 37) % 240));
    // План для катушки 200 м
    const { changes } = planSpools(seq, 2000, 50, 200);
    // Хотя бы одна смена на гвозде 7
    expect(changes.some((c) => c.nail === 7)).toBe(true);
  });
});

// Группа: прогноз времени
describe("время до конца", () => {
  // Свой темп считается после 30 шагов
  it("темп: свой после 30 шагов, иначе — скорость перелистывания", () => {
    // 10 шагов — мало, берём скорость перелистывания
    expect(secPerStep({ total_sec: 100, total_steps: 10 }, 2)).toBe(2);
    // 40 шагов — свой темп 3 с
    expect(secPerStep({ total_sec: 120, total_steps: 40 }, 2)).toBe(3);
  });

  // Форматирование длительности
  it("форматирование длительности", () => {
    // Меньше минуты
    expect(duration(20)).toBe("меньше минуты");
    // Минуты
    expect(duration(25 * 60)).toBe("25 мин");
    // Часы и минуты
    expect(duration(3 * 3600 + 40 * 60)).toBe("3 ч 40 мин");
    // Ровно часы
    expect(duration(2 * 3600)).toBe("2 ч");
  });

  // Прогноз и дата окончания
  it("прогноз и дата окончания по среднему за день", () => {
    // «Сегодня» — 27 октября 2026
    const today = new Date(2026, 9, 27);
    // Учёт:
    const activity: Activity = {
      // 2 часа
      total_sec: 7200,
      // 2400 шагов
      total_steps: 2400,
      // по дням:
      days: [
        // час в первый день
        { date: "2026-10-25", sec: 3600, steps: 1200 },
        // час во второй
        { date: "2026-10-26", sec: 3600, steps: 1200 },
      ],
    };
    // В среднем час в день
    expect(dailyAverageSec(activity)).toBe(3600);
    // Прогноз: темп 2 с, сейчас шаг 2401 из 6000
    const e = estimate(activity, 2, 2401, 6000, today);
    // Темп измерен
    expect(e.measured).toBe(true);
    // 3 с на шаг
    expect(e.paceSec).toBe(3);
    // Осталось 3 часа
    expect(e.remainingSec).toBe(3600 * 3);
    // Закончим 29-го
    expect(e.finishDate?.getDate()).toBe(29); // 3 часа по часу в день: сегодня, завтра, послезавтра
    // Без учёта даты нет
    expect(estimate(EMPTY, 2, 1, 100, today).finishDate).toBeNull();
    // Сегодня
    expect(finishText(new Date(2026, 9, 27), today)).toBe("сегодня");
    // Завтра
    expect(finishText(new Date(2026, 9, 28), today)).toBe("завтра");
    // Дата в формате ISO по местному времени
    expect(localDay(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  // Склонения
  it("склонения", () => {
    // 1 шаг, 2 шага, 5 шагов, 11 шагов, 21 шаг, 22 шага, 112 шагов
    expect([1, 2, 5, 11, 21, 22, 112].map((n) => plural(n, ["шаг", "шага", "шагов"]))).toEqual([
      // Ожидаемые формы
      "шаг", "шага", "шагов", "шагов", "шаг", "шага", "шагов",
    ]);
  });
});

// Группа: управление без рук
describe("управление без рук", () => {
  // Таблица клавиш кликера
  it.each([
    // Вперёд
    ["PageDown", "next"],
    // Вперёд
    ["ArrowRight", "next"],
    // Медиаклавиша «следующий»
    ["MediaTrackNext", "next"],
    // Назад
    ["PageUp", "prev"],
    // B — старт/пауза
    ["b", "toggle"],
    // Та же клавиша в русской раскладке
    ["и", "toggle"],
    // Точка — кнопка «экран» у кликеров
    [".", "toggle"],
    // Медиаклавиша
    ["MediaPlayPause", "toggle"],
    // Быстрее
    ["ArrowUp", "faster"],
    // Незнакомая клавиша — ничего
    ["x", null],
  // Имя теста
  ])("клавиша %s → %s", (key, cmd) => {
    // Команда совпадает
    expect(keyCommand({ key, code: "" })).toBe(cmd);
  });

  // Таблица голосовых фраз
  it.each([
    // Дальше
    ["Дальше", "next"],
    // С восклицательным знаком
    ["вперёд!", "next"],
    // Слово в конце фразы
    ["нить, дальше", "next"],
    // Назад
    ["назад", "prev"],
    // Стоп с точкой
    ["Стоп.", "pause"],
    // Старт
    ["поехали", "play"],
    // Медленнее
    ["помедленнее", "slower"],
    // Повторить
    ["ещё раз", "repeat"],
    // Длинная фраза со словом «дальше» в середине — не команда
    ["и тогда мы пошли дальше по дороге", null],
    // Пусто
    ["", null],
    // Незнакомое слово
    ["привет", null],
  // Имя теста
  ])("голос «%s» → %s", (text, cmd) => {
    // Команда совпадает
    expect(voiceCommand(text)).toBe(cmd);
  });
});

// Группа: видео и обновления
describe("видео и обновления", () => {
  // Кадры таймлапса
  it("кадры таймлапса: от 0 до всех линий, без откатов", () => {
    // 301 кадр для 4000 нитей
    const xs = Array.from({ length: 301 }, (_, f) => linesAtFrame(f, 300, 4000));
    // Первый кадр пустой
    expect(xs[0]).toBe(0);
    // Последний — все нити
    expect(xs.at(-1)).toBe(4000);
    // Каждый кадр не меньше предыдущего
    expect(xs.every((v, i) => i === 0 || v >= xs[i - 1])).toBe(true);
  });

  // Без MediaRecorder видео не записать
  it("без MediaRecorder видео не записать — честно говорим", () => {
    // Формат не выбран — кнопка честно скажет, что не получится
    expect(videoFormat()).toBeNull();
  });

  // Сравнение версий
  it("версии", () => {
    // Номер из названия релиза
    expect(parseVersion("Нитеграф для Windows 1.4.12")).toEqual([1, 4, 12]);
    // 12 больше 9 — сравниваем числа, а не строки
    expect(isNewer("1.4.12", "1.4.9")).toBe(true);
    // Та же версия — не новее
    expect(isNewer("1.4.9", "1.4.9")).toBe(false);
    // Младшая — не новее
    expect(isNewer("1.3.20", "1.4.1")).toBe(false);
    // «dev» не сравнивается
    expect(isNewer("1.4.1", "dev")).toBe(false);
    // Из ответа GitHub —
    expect(
      // — разбираем релиз:
      releaseFromGithub({
        // название
        name: "Нитеграф для Windows 1.4.12",
        // файлы
        assets: [
          // архив
          { name: "Nitegraf-portable.zip", browser_download_url: "https://x/zip" },
          // установщик
          { name: "Nitegraf-Setup.exe", browser_download_url: "https://x/setup" },
        ],
      }),
    // Берётся версия и ссылка на установщик
    ).toEqual({ version: "1.4.12", url: "https://x/setup" });
  });

  // GitHub спрашиваем не чаще раза в 6 часов
  it("релиз проверяется не чаще раза в 6 часов", async () => {
    // Подделка fetch
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ name: "Нитеграф 1.4.3", assets: [] })));
    // Первый запрос — идёт на GitHub
    expect((await latestRelease(1_000, fetcher as unknown as typeof fetch))?.version).toBe("1.4.3");
    // Через час —
    await latestRelease(1_000 + 3600_000, fetcher as unknown as typeof fetch);
    // — запрос не повторяется
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Через 7 часов —
    await latestRelease(1_000 + 7 * 3600_000, fetcher as unknown as typeof fetch);
    // — повторяется
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

// Группа: студия
describe("студия", () => {
  // Сравнение с фото и вид на стене
  it("сравнение с фото и вид на стене", () => {
    // Рисуем сцену
    render(<StageView sequence={LONG} lines={1000} diameterCm={50} name="Тест" photoUrl="/p.png" />);
    // Режим «Сравнить»
    fireEvent.click(screen.getByRole("radio", { name: /Сравнить/ }));
    // Ползунок границы
    const slider = within(screen.getByTestId("compare")).getByRole("slider", { name: "Граница между фото и нитями" });
    // Граница на 30 %
    fireEvent.change(slider, { target: { value: "30" } });
    // Фото обрезано справа на 70 %
    expect(screen.getByAltText("Фото после обработки")).toHaveStyle({ clipPath: "inset(0 70% 0 0)" });
    // Режим «На стене»
    fireEvent.click(screen.getByRole("radio", { name: /На стене/ }));
    // По умолчанию с 3 м
    expect(screen.getByTestId("wall-note")).toHaveTextContent("видна с 3 м");
    // Выбираем 5 м
    fireEvent.click(screen.getByRole("radio", { name: "5 м" }));
    // Подпись поменялась
    expect(screen.getByTestId("wall-note")).toHaveTextContent("видна с 5 м");
  });

  // Своя катушка
  it("своя катушка: план и сохранение", () => {
    // Шпион
    const onChange = vi.fn();
    // Рисуем планировщик без своей катушки
    const { rerender } = render(
      // Стандартная катушка 2000 м
      <SpoolPlanner sequence={LONG} lines={3000} diameterCm={50} standardSpoolM={2000} ownSpoolM={null} onChange={onChange} />,
    );
    // Хватит одной
    expect(screen.getByTestId("spool-plan")).toHaveTextContent("Одной катушки 2 000 м хватит");
    // Поле длины своей катушки
    const input = screen.getByLabelText("Длина моей катушки, м");
    // Вводим 300
    fireEvent.change(input, { target: { value: "300" } });
    // Уходим из поля
    fireEvent.blur(input);
    // Сохранено
    expect(onChange).toHaveBeenCalledWith(300);
    // Рисуем со своей катушкой 300 м
    rerender(<SpoolPlanner sequence={LONG} lines={3000} diameterCm={50} standardSpoolM={2000} ownSpoolM={300} onChange={onChange} />);
    // Понадобится несколько
    expect(screen.getByTestId("spool-plan")).toHaveTextContent(/Понадобится \d+ катуш/);
    // Список смен
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(1);
    // Стираем
    fireEvent.change(input, { target: { value: "" } });
    // Уходим из поля
    fireEvent.blur(input);
    // Своя катушка сброшена
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

// Группа: удобства плетения
describe("плетение: кликер, голос, катушка, перерыв", () => {
  // После каждого теста —
  afterEach(() => {
    // — настоящее время
    vi.useRealTimers();
    // — настоящие глобальные объекты
    vi.unstubAllGlobals();
  });

  // Текст счётчика шагов
  const counter = () => screen.getByTestId("step-counter").textContent?.replace(/\s+/g, " ");

  // Кликер
  it("кликер: PageDown/PageUp листают, B — старт и пауза; вкладка показывает клавишу", () => {
    // Рисуем проигрыватель
    render(<WeavePlayer sequence={LONG} totalSteps={100} diameterCm={50} initialStep={1} initialSpeedSec={2} />);
    // PageDown
    fireEvent.keyDown(window, { key: "PageDown" });
    // Ещё раз
    fireEvent.keyDown(window, { key: "PageDown" });
    // Шаг 3
    expect(counter()).toContain("Шаг 3 из");
    // PageUp
    fireEvent.keyDown(window, { key: "PageUp" });
    // Шаг 2
    expect(counter()).toContain("Шаг 2 из");
    // B
    fireEvent.keyDown(window, { key: "b" });
    // Пошло воспроизведение
    expect(screen.getByRole("button", { name: "Пауза" })).toBeInTheDocument();
    // Вкладка «Управление»
    fireEvent.click(screen.getByRole("tab", { name: /Управление/ }));
    // Нажимаем клавишу —
    fireEvent.keyDown(window, { key: "PageDown" });
    // — проверка клавиш показывает, что она значит
    expect(screen.getByTestId("key-test")).toHaveTextContent("PageDown → вперёд");
  });

  // Голосовые команды
  it("голос: «дальше» и «стоп» через распознавание речи", () => {
    // Сюда попадёт созданный распознаватель
    let instance: { onresult: ((e: unknown) => void) | null } | null = null;
    // Подделка распознавания речи
    class FakeRecognition {
      // язык
      lang = "";
      // непрерывно
      continuous = false;
      // промежуточные результаты
      interimResults = false;
      // вариантов
      maxAlternatives = 1;
      // обработчик результата
      onresult: ((e: unknown) => void) | null = null;
      // обработчик ошибки
      onerror = null;
      // обработчик окончания
      onend = null;
      // При создании —
      constructor() {
        // — запоминаем себя
        instance = this;
      }
      // Старт
      start() {}
      // Стоп
      stop() {}
    }
    // Ставим подделку вместо браузерного распознавания
    vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
    // Рисуем
    render(<WeavePlayer sequence={LONG} totalSteps={100} diameterCm={50} initialStep={1} initialSpeedSec={2} />);
    // Вкладка «Управление»
    fireEvent.click(screen.getByRole("tab", { name: /Управление/ }));
    // Включаем голос
    fireEvent.click(screen.getByRole("switch", { name: "Голосовые команды" }));
    // Помощник: «произносим» фразу
    const say = (text: string) =>
      // Отдаём распознавателю результат в формате браузера
      act(() => instance!.onresult!({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] }));
    // «Дальше»
    say("дальше");
    // Шаг 2
    expect(counter()).toContain("Шаг 2 из");
    // «Поехали»
    say("поехали");
    // Пошло воспроизведение
    expect(screen.getByRole("button", { name: "Пауза" })).toBeInTheDocument();
    // «Стоп»
    say("стоп");
    // Пауза
    expect(screen.getByRole("button", { name: "Продолжить" })).toBeInTheDocument();
    // Видно, что услышано
    expect(screen.getByTestId("voice-heard")).toHaveTextContent("стоп");
    // Включение запомнено
    expect(localStorage.getItem("stringart.voiceControl")).toBe("1");
  });

  // Подсказка о смене катушки
  it("за 40 шагов — подсказка о смене катушки, на шаге смены — что делать", () => {
    // План для катушки 300 м
    const { changes } = planSpools(LONG, 3000, 50, 300);
    // Шаг первой смены
    const at = changes[0].afterStep;
    // Рисуем за 10 шагов до смены
    const { unmount } = render(
      // Проигрыватель со своей катушкой
      <WeavePlayer sequence={LONG} totalSteps={3000} diameterCm={50} initialStep={at - 10} initialSpeedSec={2} spoolM={300} />,
    );
    // Подсказка «через 10 шагов»
    expect(screen.getByTestId("spool-alert")).toHaveTextContent(`Через 10 шагов смена катушки`);
    // И гвоздь, где завязать узел
    expect(screen.getByTestId("spool-alert")).toHaveTextContent(changes[0].label);
    // Убираем
    unmount();
    // Рисуем на самом шаге смены
    render(<WeavePlayer sequence={LONG} totalSteps={3000} diameterCm={50} initialStep={at} initialSpeedSec={2} spoolM={300} />);
    // «Катушка кончается»
    expect(screen.getByTestId("spool-alert")).toHaveTextContent("кончается");
  });

  // Напоминание о перерыве
  it("напоминание о перерыве после N минут работы и сам перерыв", () => {
    // Искусственное время
    vi.useFakeTimers();
    // Напоминать каждые 30 минут
    localStorage.setItem("stringart.breaks", "30");
    // Рисуем
    render(<WeavePlayer sequence={LONG} totalSteps={3000} diameterCm={50} initialStep={1} initialSpeedSec={10} />);
    // «Старт»
    fireEvent.click(screen.getByRole("button", { name: "Старт" }));
    // Через 29 минут —
    act(() => vi.advanceTimersByTime(29 * 60 * 1000));
    // — напоминания ещё нет
    expect(screen.queryByTestId("break-toast")).not.toBeInTheDocument();
    // Ещё минута —
    act(() => vi.advanceTimersByTime(61 * 1000));
    // — напоминание
    expect(screen.getByTestId("break-toast")).toHaveTextContent("Вы плетёте уже 30 мин");
    // «Перерыв 5 минут»
    fireEvent.click(screen.getByRole("button", { name: "Перерыв 5 минут" }));
    // Плетение на паузе
    expect(screen.getByRole("button", { name: "Продолжить" })).toBeInTheDocument(); // плетение на паузе
    // Обратный отсчёт
    expect(screen.getByTestId("break-toast")).toHaveTextContent("Перерыв: 5:00");
    // Через 5 минут —
    act(() => vi.advanceTimersByTime(5 * 60 * 1000 + 1000));
    // — напоминание исчезло
    expect(screen.queryByTestId("break-toast")).not.toBeInTheDocument();
  });
});

// Группа: уведомление об обновлении
describe("уведомление об обновлении", () => {
  // После каждого теста — настоящий fetch
  afterEach(() => vi.unstubAllGlobals());

  // Показывается только в программе и только для новой версии
  it("только в программе для Windows и только если версия новее", async () => {
    // Помощник: подделка fetch с нужным ответом про программу
    const respond = (app: object) =>
      // Подделка
      vi.fn(async (url: string) =>
        // Если спрашивают настройки —
        url.includes("/api/config")
          // — отвечаем про программу
          ? new Response(JSON.stringify({ app }))
          // Иначе — это GitHub:
          : new Response(
              // релиз 1.4.9 с установщиком
              JSON.stringify({ name: "Нитеграф для Windows 1.4.9", assets: [{ name: "Nitegraf-Setup.exe", browser_download_url: "https://x/setup.exe" }] }),
            ),
      );
    // Программа версии 1.4.2
    vi.stubGlobal("fetch", respond({ version: "1.4.2", desktop: true }));
    // Рисуем
    const { unmount } = render(<UpdateNotice />);
    // Дожидаемся уведомления
    const notice = await screen.findByTestId("update-notice");
    // Новая версия
    expect(notice).toHaveTextContent("1.4.9");
    // Ссылка на установщик
    expect(within(notice).getByRole("link", { name: "Скачать" })).toHaveAttribute("href", "https://x/setup.exe");
    // «Позже»
    fireEvent.click(within(notice).getByRole("button", { name: "Позже" }));
    // Уведомление скрылось
    expect(screen.queryByTestId("update-notice")).not.toBeInTheDocument();
    // Убираем
    unmount();
    // «Позже» запомнилось для этой версии
    // Рисуем снова
    render(<UpdateNotice />);
    // Ждём 20 мс
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    // Не показывается
    expect(screen.queryByTestId("update-notice")).not.toBeInTheDocument();
  });

  // В браузере ничего не показывается
  it("в браузере (не программа) — ничего не показывает и не ходит на GitHub", async () => {
    // Подделка: не программа
    const f = vi.fn(async () => new Response(JSON.stringify({ app: { version: "dev", desktop: false } })));
    // Ставим
    vi.stubGlobal("fetch", f);
    // Рисуем
    render(<UpdateNotice />);
    // Ждём 20 мс
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    // Уведомления нет
    expect(screen.queryByTestId("update-notice")).not.toBeInTheDocument();
    // Был только запрос настроек — на GitHub не ходили
    expect(f).toHaveBeenCalledTimes(1);
  });
});
