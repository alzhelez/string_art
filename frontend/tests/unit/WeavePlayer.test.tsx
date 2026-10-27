import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeavePlayer } from "@/components/WeavePlayer";

// A1 → C1 → A31 → C31 → A1 → B1
const SEQ = [0, 120, 30, 150, 0, 60];

function setup(overrides: Partial<Parameters<typeof WeavePlayer>[0]> = {}) {
  const onStepChange = vi.fn();
  const onSpeedChange = vi.fn();
  render(
    <WeavePlayer
      sequence={SEQ}
      totalSteps={5}
      diameterCm={50}
      initialStep={1}
      initialSpeedSec={2}
      onStepChange={onStepChange}
      onSpeedChange={onSpeedChange}
      {...overrides}
    />,
  );
  return { onStepChange, onSpeedChange };
}

const current = () => screen.getByTestId("current-step").textContent?.replace(/\s+/g, " ").trim();

describe("WeavePlayer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("показывает первый шаг и подсказку про A1", () => {
    setup();
    expect(current()).toBe("A1 → C1");
    expect(screen.getByTestId("step-counter")).toHaveTextContent("Шаг 1 из 5");
    expect(screen.getByText(/Привяжите леску к гвоздю A1/)).toBeInTheDocument();
  });

  it("автоперелистывание каждые 2 секунды по умолчанию", () => {
    const { onStepChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Старт" }));
    act(() => vi.advanceTimersByTime(1999));
    expect(current()).toBe("A1 → C1");
    act(() => vi.advanceTimersByTime(1));
    expect(current()).toBe("C1 → A31");
    act(() => vi.advanceTimersByTime(2000));
    expect(current()).toBe("A31 → C31");
    expect(onStepChange).toHaveBeenLastCalledWith(3);
  });

  it("кнопки скорости меняют интервал на 0,1 с", () => {
    const { onSpeedChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Быстрее/ }));
    expect(screen.getByTestId("speed")).toHaveTextContent("1,9 с на шаг");
    expect(onSpeedChange).toHaveBeenLastCalledWith(1.9);

    fireEvent.click(screen.getByRole("button", { name: "Старт" }));
    act(() => vi.advanceTimersByTime(1900));
    expect(current()).toBe("C1 → A31");

    fireEvent.click(screen.getByRole("button", { name: /Медленнее/ }));
    fireEvent.click(screen.getByRole("button", { name: /Медленнее/ }));
    expect(screen.getByTestId("speed")).toHaveTextContent("2,1 с на шаг");
    act(() => vi.advanceTimersByTime(2099));
    expect(current()).toBe("C1 → A31");
    act(() => vi.advanceTimersByTime(1));
    expect(current()).toBe("A31 → C31");
  });

  it("на минимальной скорости кнопка «Быстрее» неактивна", () => {
    setup({ initialSpeedSec: 0.5 });
    expect(screen.getByRole("button", { name: /Быстрее/ })).toBeDisabled();
  });

  it("пауза останавливает перелистывание", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Старт" }));
    fireEvent.click(screen.getByRole("button", { name: "Пауза" }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(current()).toBe("A1 → C1");
  });

  it("продолжает с сохранённого шага", () => {
    setup({ initialStep: 4 });
    expect(current()).toBe("C31 → A1");
    expect(screen.getByRole("button", { name: "Продолжить" })).toBeInTheDocument();
  });

  it("на последнем шаге останавливается и пишет «Готово»", () => {
    setup({ initialStep: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByTestId("finished")).toBeInTheDocument();
    expect(current()).toBe("A1 → B1");
  });

  it("назад/вперёд и клавиатура", () => {
    const { onStepChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Вперёд" }));
    expect(current()).toBe("C1 → A31");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(current()).toBe("A31 → C31");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    expect(current()).toBe("A1 → C1");
    expect(screen.getByRole("button", { name: "Назад" })).toBeDisabled();
    expect(onStepChange).toHaveBeenCalledTimes(4);

    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(screen.getByTestId("speed")).toHaveTextContent("1,9 с");
    fireEvent.keyDown(window, { code: "Space", key: " " });
    expect(screen.getByRole("button", { name: "Пауза" })).toBeInTheDocument();
  });

  it("переход к шагу по номеру с ограничением диапазона", () => {
    setup();
    fireEvent.click(screen.getByRole("tab", { name: /Переход/ }));
    const input = screen.getByLabelText("Перейти к шагу");
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: "Перейти" }));
    expect(screen.getByTestId("step-counter")).toHaveTextContent("Шаг 5 из 5");
  });

  it("показывает, сколько лески уже натянуто", () => {
    setup({ initialStep: 3 });
    // до шага 3 натянуты две хорды через центр: 2 × 0,5 м
    expect(screen.getByTestId("thread-used")).toHaveTextContent("Уже натянуто 1,0 м");
  });
});
