// Обновление программы для Windows в одну кнопку: плашка, ход скачивания, ошибка и «Повторить»

// Отрисовка, события, поиск, ожидание, act
import { act, fireEvent, render, screen, within } from "@testing-library/react";
// Описание тестов, хуки, проверки, подмены
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Плашка и текст хода обновления
import { UpdateNotice, updateText, UPDATE_POLL_MS } from "@/components/UpdateNotice";
// Тип состояния
import type { UpdateStatus } from "@/lib/api";

// Состояние «по умолчанию» для текстов
const base: UpdateStatus = { state: "idle", version: "1.4.20", done: 0, total: 0, error: null, supported: true };

// Ответ «GitHub»: релиз 1.4.20 с установщиком
const github = { name: "Нитеграф для Windows 1.4.20", assets: [{ name: "Nitegraf-Setup.exe", browser_download_url: "https://x/setup.exe" }] };

// Ответ JSON с кодом
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// Группа тестов
describe("обновление в одну кнопку", () => {
  // Перед каждым тестом — чистое хранилище (кэш релиза и «Позже»)
  beforeEach(() => localStorage.clear());
  // После каждого — настоящие таймеры и fetch
  afterEach(() => {
    // Таймеры
    vi.useRealTimers();
    // fetch
    vi.unstubAllGlobals();
  });

  // Тексты каждого шага
  it("updateText: понятный текст на каждом шаге", () => {
    // Проверяем релиз
    expect(updateText({ ...base, state: "checking" })).toContain("Проверяем последнюю версию");
    // Качаем с известным размером: проценты и мегабайты с запятой
    expect(updateText({ ...base, state: "downloading", done: 3 * 1048576, total: 4 * 1048576 })).toBe(
      // Ожидаемый текст
      "Скачиваем версию 1.4.20: 75 % (3,0 из 4,0 МБ)",
    );
    // Размер неизвестен — только мегабайты
    expect(updateText({ ...base, state: "downloading", done: 1572864 })).toBe("Скачиваем версию 1.4.20: 1,5 МБ");
    // Проверка суммы
    expect(updateText({ ...base, state: "verifying" })).toContain("скачался целым");
    // Установка
    expect(updateText({ ...base, state: "installing" })).toContain("закроется и через полминуты откроется снова");
    // Ошибка с текстом
    expect(updateText({ ...base, state: "error", error: "Контрольная сумма не совпала" })).toBe("Контрольная сумма не совпала");
    // Ошибка без текста
    expect(updateText({ ...base, state: "error" })).toBe("Обновление не удалось");
  });

  // Полный путь: «Обновить» → скачивание с полосой → установка
  it("«Обновить»: скачивание с полосой, затем установка; кнопки прячутся", async () => {
    // Подменённые таймеры — опрос идёт по нашей команде
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Ответы опроса по очереди
    const polls = [
      // Качаем половину
      { ...base, state: "downloading", done: 50, total: 100 },
      // Установка
      { ...base, state: "installing", done: 100, total: 100 },
    ];
    // Подделка fetch
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      // Настройки: программа 1.4.10, умеет обновляться
      if (url.includes("/api/config")) return json({ app: { version: "1.4.10", desktop: true, update: true } });
      // Релиз на GitHub
      if (url.includes("api.github.com")) return json(github);
      // Старт обновления
      if (url === "/api/update" && init?.method === "POST") return json({ ...base, state: "checking" }, 202);
      // Опрос: следующий ответ или «сервер закрылся»
      const next = polls.shift();
      // Сервер закрылся — как настоящий fetch без связи
      if (!next) throw new TypeError("Failed to fetch");
      // Ответ опроса
      return json(next);
    });
    // Ставим
    vi.stubGlobal("fetch", fetchMock);
    // Рисуем
    render(<UpdateNotice />);
    // Плашка
    const notice = await screen.findByTestId("update-notice");
    // «Скачать» стал запасным (прозрачная кнопка), главная — «Обновить»
    expect(within(notice).getByRole("link", { name: "Скачать" })).toHaveClass("ghost");
    // Нажимаем «Обновить»
    fireEvent.click(within(notice).getByTestId("update-now"));
    // Сразу — «проверяем»
    expect(await screen.findByTestId("update-progress")).toHaveTextContent("Проверяем последнюю версию");
    // Кнопок больше нет — дважды не нажать
    expect(within(notice).queryByRole("button")).toBeNull();
    // Первый опрос
    await act(async () => vi.advanceTimersByTimeAsync(UPDATE_POLL_MS));
    // Качаем 50 %
    expect(screen.getByTestId("update-progress")).toHaveTextContent("50 %");
    // Полоса прогресса
    expect(screen.getByRole("progressbar", { name: "Скачано" })).toHaveAttribute("value", "50");
    // Второй опрос
    await act(async () => vi.advanceTimersByTimeAsync(UPDATE_POLL_MS));
    // Установка
    expect(screen.getByTestId("update-progress")).toHaveTextContent("Устанавливаем 1.4.20");
    // Третий опрос — сервер уже закрылся
    await act(async () => vi.advanceTimersByTimeAsync(UPDATE_POLL_MS));
    // Текст установки остался, ошибки нет
    expect(screen.getByTestId("update-progress")).toHaveTextContent("Устанавливаем 1.4.20");
    // Старт был ровно один раз
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toHaveLength(1);
  });

  // Ошибка: понятный текст и «Повторить»
  it("ошибка обновления: текст и кнопка «Повторить»", async () => {
    // Подделка fetch
    vi.stubGlobal(
      // Глобальный fetch
      "fetch",
      // Ответы
      vi.fn(async (url: string, init?: RequestInit) => {
        // Настройки
        if (url.includes("/api/config")) return json({ app: { version: "1.4.10", desktop: true, update: true } });
        // GitHub
        if (url.includes("api.github.com")) return json(github);
        // Старт — сразу ошибка (например, нет интернета у сервера)
        if (init?.method === "POST") return json({ ...base, state: "error", error: "Не удалось связаться с GitHub — проверьте интернет" }, 202);
        // Опросов быть не должно
        throw new Error("лишний опрос");
      }),
    );
    // Рисуем
    render(<UpdateNotice />);
    // Нажимаем «Обновить»
    fireEvent.click(await screen.findByTestId("update-now"));
    // Текст ошибки
    expect(await screen.findByText(/проверьте интернет/)).toHaveClass("update-error");
    // Кнопка «Повторить» и запасная ссылка
    expect(screen.getByTestId("update-now")).toHaveTextContent("Повторить");
    // Ссылка «Скачать» на месте
    expect(screen.getByRole("link", { name: "Скачать" })).toBeInTheDocument();
  });

  // Сервер отказал (например, сборка разработчика) — текст отказа
  it("сервер отказал — его текст", async () => {
    // Подделка fetch
    vi.stubGlobal(
      // Глобальный fetch
      "fetch",
      // Ответы
      vi.fn(async (url: string, init?: RequestInit) => {
        // Настройки
        if (url.includes("/api/config")) return json({ app: { version: "1.4.10", desktop: true, update: true } });
        // GitHub
        if (url.includes("api.github.com")) return json(github);
        // Старт — 404
        if (init?.method === "POST") return json({ detail: "Обновление в одну кнопку есть только в программе для Windows" }, 404);
        // Иначе — ошибка
        throw new Error("лишний запрос");
      }),
    );
    // Рисуем
    render(<UpdateNotice />);
    // Нажимаем
    fireEvent.click(await screen.findByTestId("update-now"));
    // Текст отказа
    expect(await screen.findByText(/только в программе для Windows/)).toBeInTheDocument();
  });

  // Программа не умеет обновляться сама — только «Скачать» (как раньше)
  it("без обновления в одну кнопку — только «Скачать»", async () => {
    // Подделка fetch: update не передан
    vi.stubGlobal(
      // Глобальный fetch
      "fetch",
      // Ответы
      vi.fn(async (url: string) => (url.includes("/api/config") ? json({ app: { version: "1.4.10", desktop: true } }) : json(github))),
    );
    // Рисуем
    render(<UpdateNotice />);
    // Плашка
    const notice = await screen.findByTestId("update-notice");
    // Кнопки «Обновить» нет
    expect(within(notice).queryByTestId("update-now")).toBeNull();
    // «Скачать» — главная кнопка
    expect(within(notice).getByRole("link", { name: "Скачать" })).toHaveClass("primary");
  });
});
