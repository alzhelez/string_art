import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpoolPlanner } from "@/components/studio/SpoolPlanner";
import { StageView } from "@/components/studio/StageView";
import { UpdateNotice } from "@/components/UpdateNotice";
import { WeavePlayer } from "@/components/WeavePlayer";
import type { Activity } from "@/lib/api";
import { keyCommand, voiceCommand } from "@/lib/control";
import { dailyAverageSec, duration, estimate, finishText, localDay, secPerStep } from "@/lib/eta";
import { plural } from "@/lib/format";
import { linesAtFrame, videoFormat } from "@/lib/share";
import { nextChange, planSpools } from "@/lib/spool";
import { cumulativeLengthsM } from "@/lib/thread";
import { isNewer, latestRelease, parseVersion, releaseFromGithub } from "@/lib/update";

beforeEach(() => localStorage.clear());

/** Длинная «настоящая» последовательность: прыжки через полкруга с дрейфом. */
const LONG = Array.from({ length: 3001 }, (_, i) => (i * 113) % 240);
const EMPTY: Activity = { total_sec: 0, total_steps: 0, days: [] };

describe("план смены катушки", () => {
  it("хватает одной катушки — смен нет", () => {
    expect(planSpools(LONG, 3000, 50, 100_000)).toEqual({ changes: [], spools: 1 });
  });

  it("маленькая катушка: смены по порядку, ни одна катушка не перерасходована", () => {
    const { changes, spools } = planSpools(LONG, 3000, 50, 300);
    const raw = cumulativeLengthsM(LONG, 50);
    expect(spools).toBe(changes.length + 1);
    expect(changes.length).toBeGreaterThan(2);
    let start = 0;
    for (const c of changes) {
      expect(c.afterStep).toBeGreaterThan(start);
      expect((raw[c.afterStep] - raw[start]) * 1.15).toBeLessThanOrEqual(300 - 0.5 + 1e-9);
      // узел — не раньше последних 3 % катушки (не тратим леску зря)
      expect((raw[c.afterStep] - raw[start]) * 1.15).toBeGreaterThan(300 * 0.9);
      expect(c.label).toMatch(/^[ABCD]\d{1,2}$/);
      start = c.afterStep;
    }
    expect((raw[3000] - raw[start]) * 1.15).toBeLessThanOrEqual(300);
    expect(nextChange(changes, 1)).toBe(changes[0]);
    expect(nextChange(changes, changes[0].afterStep + 1)).toBe(changes[1]);
    expect(nextChange(changes, 3000)).toBeNull();
  });

  it("узел — на гвозде, через который проходит больше нитей", () => {
    // гвоздь 7 встречается очень часто — среди равных по длине вариантов выбираем его
    const seq = Array.from({ length: 2001 }, (_, i) => (i % 2 === 0 ? 7 : (i * 37) % 240));
    const { changes } = planSpools(seq, 2000, 50, 200);
    expect(changes.some((c) => c.nail === 7)).toBe(true);
  });
});

describe("время до конца", () => {
  it("темп: свой после 30 шагов, иначе — скорость перелистывания", () => {
    expect(secPerStep({ total_sec: 100, total_steps: 10 }, 2)).toBe(2);
    expect(secPerStep({ total_sec: 120, total_steps: 40 }, 2)).toBe(3);
  });

  it("форматирование длительности", () => {
    expect(duration(20)).toBe("меньше минуты");
    expect(duration(25 * 60)).toBe("25 мин");
    expect(duration(3 * 3600 + 40 * 60)).toBe("3 ч 40 мин");
    expect(duration(2 * 3600)).toBe("2 ч");
  });

  it("прогноз и дата окончания по среднему за день", () => {
    const today = new Date(2026, 9, 27);
    const activity: Activity = {
      total_sec: 7200,
      total_steps: 2400,
      days: [
        { date: "2026-10-25", sec: 3600, steps: 1200 },
        { date: "2026-10-26", sec: 3600, steps: 1200 },
      ],
    };
    expect(dailyAverageSec(activity)).toBe(3600);
    const e = estimate(activity, 2, 2401, 6000, today);
    expect(e.measured).toBe(true);
    expect(e.paceSec).toBe(3);
    expect(e.remainingSec).toBe(3600 * 3);
    expect(e.finishDate?.getDate()).toBe(29); // 3 часа по часу в день: сегодня, завтра, послезавтра
    expect(estimate(EMPTY, 2, 1, 100, today).finishDate).toBeNull();
    expect(finishText(new Date(2026, 9, 27), today)).toBe("сегодня");
    expect(finishText(new Date(2026, 9, 28), today)).toBe("завтра");
    expect(localDay(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("склонения", () => {
    expect([1, 2, 5, 11, 21, 22, 112].map((n) => plural(n, ["шаг", "шага", "шагов"]))).toEqual([
      "шаг", "шага", "шагов", "шагов", "шаг", "шага", "шагов",
    ]);
  });
});

describe("управление без рук", () => {
  it.each([
    ["PageDown", "next"],
    ["ArrowRight", "next"],
    ["MediaTrackNext", "next"],
    ["PageUp", "prev"],
    ["b", "toggle"],
    ["и", "toggle"],
    [".", "toggle"],
    ["MediaPlayPause", "toggle"],
    ["ArrowUp", "faster"],
    ["x", null],
  ])("клавиша %s → %s", (key, cmd) => {
    expect(keyCommand({ key, code: "" })).toBe(cmd);
  });

  it.each([
    ["Дальше", "next"],
    ["вперёд!", "next"],
    ["нить, дальше", "next"],
    ["назад", "prev"],
    ["Стоп.", "pause"],
    ["поехали", "play"],
    ["помедленнее", "slower"],
    ["ещё раз", "repeat"],
    ["и тогда мы пошли дальше по дороге", null],
    ["", null],
    ["привет", null],
  ])("голос «%s» → %s", (text, cmd) => {
    expect(voiceCommand(text)).toBe(cmd);
  });
});

describe("видео и обновления", () => {
  it("кадры таймлапса: от 0 до всех линий, без откатов", () => {
    const xs = Array.from({ length: 301 }, (_, f) => linesAtFrame(f, 300, 4000));
    expect(xs[0]).toBe(0);
    expect(xs.at(-1)).toBe(4000);
    expect(xs.every((v, i) => i === 0 || v >= xs[i - 1])).toBe(true);
  });

  it("без MediaRecorder видео не записать — честно говорим", () => {
    expect(videoFormat()).toBeNull();
  });

  it("версии", () => {
    expect(parseVersion("Нитеграф для Windows 1.4.12")).toEqual([1, 4, 12]);
    expect(isNewer("1.4.12", "1.4.9")).toBe(true);
    expect(isNewer("1.4.9", "1.4.9")).toBe(false);
    expect(isNewer("1.3.20", "1.4.1")).toBe(false);
    expect(isNewer("1.4.1", "dev")).toBe(false);
    expect(
      releaseFromGithub({
        name: "Нитеграф для Windows 1.4.12",
        assets: [
          { name: "Nitegraf-portable.zip", browser_download_url: "https://x/zip" },
          { name: "Nitegraf-Setup.exe", browser_download_url: "https://x/setup" },
        ],
      }),
    ).toEqual({ version: "1.4.12", url: "https://x/setup" });
  });

  it("релиз проверяется не чаще раза в 6 часов", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ name: "Нитеграф 1.4.3", assets: [] })));
    expect((await latestRelease(1_000, fetcher as unknown as typeof fetch))?.version).toBe("1.4.3");
    await latestRelease(1_000 + 3600_000, fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await latestRelease(1_000 + 7 * 3600_000, fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("студия", () => {
  it("сравнение с фото и вид на стене", () => {
    render(<StageView sequence={LONG} lines={1000} diameterCm={50} name="Тест" photoUrl="/p.png" />);
    fireEvent.click(screen.getByRole("radio", { name: /Сравнить/ }));
    const slider = within(screen.getByTestId("compare")).getByRole("slider", { name: "Граница между фото и нитями" });
    fireEvent.change(slider, { target: { value: "30" } });
    expect(screen.getByAltText("Фото после обработки")).toHaveStyle({ clipPath: "inset(0 70% 0 0)" });
    fireEvent.click(screen.getByRole("radio", { name: /На стене/ }));
    expect(screen.getByTestId("wall-note")).toHaveTextContent("видна с 3 м");
    fireEvent.click(screen.getByRole("radio", { name: "5 м" }));
    expect(screen.getByTestId("wall-note")).toHaveTextContent("видна с 5 м");
  });

  it("своя катушка: план и сохранение", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SpoolPlanner sequence={LONG} lines={3000} diameterCm={50} standardSpoolM={2000} ownSpoolM={null} onChange={onChange} />,
    );
    expect(screen.getByTestId("spool-plan")).toHaveTextContent("Одной катушки 2 000 м хватит");
    const input = screen.getByLabelText("Длина моей катушки, м");
    fireEvent.change(input, { target: { value: "300" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(300);
    rerender(<SpoolPlanner sequence={LONG} lines={3000} diameterCm={50} standardSpoolM={2000} ownSpoolM={300} onChange={onChange} />);
    expect(screen.getByTestId("spool-plan")).toHaveTextContent(/Понадобится \d+ катуш/);
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(1);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe("плетение: кликер, голос, катушка, перерыв", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const counter = () => screen.getByTestId("step-counter").textContent?.replace(/\s+/g, " ");

  it("кликер: PageDown/PageUp листают, B — старт и пауза; вкладка показывает клавишу", () => {
    render(<WeavePlayer sequence={LONG} totalSteps={100} diameterCm={50} initialStep={1} initialSpeedSec={2} />);
    fireEvent.keyDown(window, { key: "PageDown" });
    fireEvent.keyDown(window, { key: "PageDown" });
    expect(counter()).toContain("Шаг 3 из");
    fireEvent.keyDown(window, { key: "PageUp" });
    expect(counter()).toContain("Шаг 2 из");
    fireEvent.keyDown(window, { key: "b" });
    expect(screen.getByRole("button", { name: "Пауза" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Управление/ }));
    fireEvent.keyDown(window, { key: "PageDown" });
    expect(screen.getByTestId("key-test")).toHaveTextContent("PageDown → вперёд");
  });

  it("голос: «дальше» и «стоп» через распознавание речи", () => {
    let instance: { onresult: ((e: unknown) => void) | null } | null = null;
    class FakeRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null;
      onerror = null;
      onend = null;
      constructor() {
        instance = this;
      }
      start() {}
      stop() {}
    }
    vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
    render(<WeavePlayer sequence={LONG} totalSteps={100} diameterCm={50} initialStep={1} initialSpeedSec={2} />);
    fireEvent.click(screen.getByRole("tab", { name: /Управление/ }));
    fireEvent.click(screen.getByRole("switch", { name: "Голосовые команды" }));
    const say = (text: string) =>
      act(() => instance!.onresult!({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] }));
    say("дальше");
    expect(counter()).toContain("Шаг 2 из");
    say("поехали");
    expect(screen.getByRole("button", { name: "Пауза" })).toBeInTheDocument();
    say("стоп");
    expect(screen.getByRole("button", { name: "Продолжить" })).toBeInTheDocument();
    expect(screen.getByTestId("voice-heard")).toHaveTextContent("стоп");
    expect(localStorage.getItem("stringart.voiceControl")).toBe("1");
  });

  it("за 40 шагов — подсказка о смене катушки, на шаге смены — что делать", () => {
    const { changes } = planSpools(LONG, 3000, 50, 300);
    const at = changes[0].afterStep;
    const { unmount } = render(
      <WeavePlayer sequence={LONG} totalSteps={3000} diameterCm={50} initialStep={at - 10} initialSpeedSec={2} spoolM={300} />,
    );
    expect(screen.getByTestId("spool-alert")).toHaveTextContent(`Через 10 шагов смена катушки`);
    expect(screen.getByTestId("spool-alert")).toHaveTextContent(changes[0].label);
    unmount();
    render(<WeavePlayer sequence={LONG} totalSteps={3000} diameterCm={50} initialStep={at} initialSpeedSec={2} spoolM={300} />);
    expect(screen.getByTestId("spool-alert")).toHaveTextContent("кончается");
  });

  it("напоминание о перерыве после N минут работы и сам перерыв", () => {
    vi.useFakeTimers();
    localStorage.setItem("stringart.breaks", "30");
    render(<WeavePlayer sequence={LONG} totalSteps={3000} diameterCm={50} initialStep={1} initialSpeedSec={10} />);
    fireEvent.click(screen.getByRole("button", { name: "Старт" }));
    act(() => vi.advanceTimersByTime(29 * 60 * 1000));
    expect(screen.queryByTestId("break-toast")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(61 * 1000));
    expect(screen.getByTestId("break-toast")).toHaveTextContent("Вы плетёте уже 30 мин");
    fireEvent.click(screen.getByRole("button", { name: "Перерыв 5 минут" }));
    expect(screen.getByRole("button", { name: "Продолжить" })).toBeInTheDocument(); // плетение на паузе
    expect(screen.getByTestId("break-toast")).toHaveTextContent("Перерыв: 5:00");
    act(() => vi.advanceTimersByTime(5 * 60 * 1000 + 1000));
    expect(screen.queryByTestId("break-toast")).not.toBeInTheDocument();
  });
});

describe("уведомление об обновлении", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("только в программе для Windows и только если версия новее", async () => {
    const respond = (app: object) =>
      vi.fn(async (url: string) =>
        url.includes("/api/config")
          ? new Response(JSON.stringify({ app }))
          : new Response(
              JSON.stringify({ name: "Нитеграф для Windows 1.4.9", assets: [{ name: "Nitegraf-Setup.exe", browser_download_url: "https://x/setup.exe" }] }),
            ),
      );
    vi.stubGlobal("fetch", respond({ version: "1.4.2", desktop: true }));
    const { unmount } = render(<UpdateNotice />);
    const notice = await screen.findByTestId("update-notice");
    expect(notice).toHaveTextContent("1.4.9");
    expect(within(notice).getByRole("link", { name: "Скачать" })).toHaveAttribute("href", "https://x/setup.exe");
    fireEvent.click(within(notice).getByRole("button", { name: "Позже" }));
    expect(screen.queryByTestId("update-notice")).not.toBeInTheDocument();
    unmount();
    // «Позже» запомнилось для этой версии
    render(<UpdateNotice />);
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(screen.queryByTestId("update-notice")).not.toBeInTheDocument();
  });

  it("в браузере (не программа) — ничего не показывает и не ходит на GitHub", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ app: { version: "dev", desktop: false } })));
    vi.stubGlobal("fetch", f);
    render(<UpdateNotice />);
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(screen.queryByTestId("update-notice")).not.toBeInTheDocument();
    expect(f).toHaveBeenCalledTimes(1);
  });
});
