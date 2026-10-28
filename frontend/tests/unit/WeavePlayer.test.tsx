// act — дожидаемся обновления React после перемотки таймеров
import { act, fireEvent, render, screen } from "@testing-library/react";
// Описание тестов, хуки, проверки, подмены
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Тестируемый компонент — проигрыватель шагов плетения
import { WeavePlayer } from "@/components/WeavePlayer";

// A1 → C1 → A31 → C31 → A1 → B1
// Короткая схема из 5 шагов: проверять удобно, считать в уме легко
const SEQ = [0, 120, 30, 150, 0, 60];

// Помощник: рисует проигрыватель с настройками по умолчанию, которые можно переопределить
function setup(overrides: Partial<Parameters<typeof WeavePlayer>[0]> = {}) {
  // Шпион смены шага
  const onStepChange = vi.fn();
  // Шпион смены скорости
  const onSpeedChange = vi.fn();
  // Рисуем
  render(
    // Проигрыватель
    <WeavePlayer
      // схема
      sequence={SEQ}
      // доступно 5 шагов
      totalSteps={5}
      // круг 50 см
      diameterCm={50}
      // начинаем с шага 1
      initialStep={1}
      // скорость 2 с
      initialSpeedSec={2}
      // шпион шага
      onStepChange={onStepChange}
      // шпион скорости
      onSpeedChange={onSpeedChange}
      // переопределения из теста
      {...overrides}
    />,
  );
  // Отдаём шпионы
  return { onStepChange, onSpeedChange };
}

// Текст текущего шага без лишних пробелов
const current = () => screen.getByTestId("current-step").textContent?.replace(/\s+/g, " ").trim();

// Группа тестов проигрывателя
describe("WeavePlayer", () => {
  // Искусственное время перед каждым тестом
  beforeEach(() => vi.useFakeTimers());
  // Настоящее — после
  afterEach(() => vi.useRealTimers());

  // Первый шаг и подсказка, с чего начать
  it("показывает первый шаг и подсказку про A1", () => {
    // Рисуем
    setup();
    // Шаг A1 → C1
    expect(current()).toBe("A1 → C1");
    // Счётчик «Шаг 1 из 5»
    expect(screen.getByTestId("step-counter")).toHaveTextContent("Шаг 1 из 5");
    // Подсказка привязать леску к A1
    expect(screen.getByText(/Привяжите леску к гвоздю A1/)).toBeInTheDocument();
  });

  // Автоперелистывание через 2 секунды
  it("автоперелистывание каждые 2 секунды по умолчанию", () => {
    // Рисуем
    const { onStepChange } = setup();
    // Нажимаем «Старт»
    fireEvent.click(screen.getByRole("button", { name: "Старт" }));
    // Почти 2 секунды
    act(() => vi.advanceTimersByTime(1999));
    // Ещё первый шаг
    expect(current()).toBe("A1 → C1");
    // Ровно 2 секунды
    act(() => vi.advanceTimersByTime(1));
    // Второй шаг
    expect(current()).toBe("C1 → A31");
    // Ещё 2 секунды
    act(() => vi.advanceTimersByTime(2000));
    // Третий шаг
    expect(current()).toBe("A31 → C31");
    // Наружу сообщён шаг 3 — для сохранения прогресса
    expect(onStepChange).toHaveBeenLastCalledWith(3);
  });

  // Кнопки скорости
  it("кнопки скорости меняют интервал на 0,1 с", () => {
    // Рисуем
    const { onSpeedChange } = setup();
    // «Быстрее»
    fireEvent.click(screen.getByRole("button", { name: /Быстрее/ }));
    // 1,9 с
    expect(screen.getByTestId("speed")).toHaveTextContent("1,9 с на шаг");
    // Новая скорость сообщена наружу
    expect(onSpeedChange).toHaveBeenLastCalledWith(1.9);

    // «Старт»
    fireEvent.click(screen.getByRole("button", { name: "Старт" }));
    // Через 1,9 с —
    act(() => vi.advanceTimersByTime(1900));
    // — уже второй шаг
    expect(current()).toBe("C1 → A31");

    // «Медленнее»
    fireEvent.click(screen.getByRole("button", { name: /Медленнее/ }));
    // Ещё раз «Медленнее»
    fireEvent.click(screen.getByRole("button", { name: /Медленнее/ }));
    // 2,1 с
    expect(screen.getByTestId("speed")).toHaveTextContent("2,1 с на шаг");
    // Почти 2,1 с
    act(() => vi.advanceTimersByTime(2099));
    // Шаг ещё не сменился
    expect(current()).toBe("C1 → A31");
    // Ровно 2,1 с
    act(() => vi.advanceTimersByTime(1));
    // Сменился
    expect(current()).toBe("A31 → C31");
  });

  // На минимальной скорости «Быстрее» не нажать
  it("на минимальной скорости кнопка «Быстрее» неактивна", () => {
    // Рисуем с 0,5 с
    setup({ initialSpeedSec: 0.5 });
    // Кнопка заблокирована
    expect(screen.getByRole("button", { name: /Быстрее/ })).toBeDisabled();
  });

  // Пауза
  it("пауза останавливает перелистывание", () => {
    // Рисуем
    setup();
    // «Старт»
    fireEvent.click(screen.getByRole("button", { name: "Старт" }));
    // «Пауза»
    fireEvent.click(screen.getByRole("button", { name: "Пауза" }));
    // Проходит 10 секунд
    act(() => vi.advanceTimersByTime(10_000));
    // Всё ещё первый шаг
    expect(current()).toBe("A1 → C1");
  });

  // Продолжение с сохранённого шага
  it("продолжает с сохранённого шага", () => {
    // Рисуем с шага 4
    setup({ initialStep: 4 });
    // Шаг 4
    expect(current()).toBe("C31 → A1");
    // Кнопка называется «Продолжить»
    expect(screen.getByRole("button", { name: "Продолжить" })).toBeInTheDocument();
  });

  // Остановка в конце
  it("на последнем шаге останавливается и пишет «Готово»", () => {
    // Рисуем с последнего шага
    setup({ initialStep: 5 });
    // «Продолжить»
    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    // Проходит 2 секунды
    act(() => vi.advanceTimersByTime(2000));
    // Надпись «Готово»
    expect(screen.getByTestId("finished")).toBeInTheDocument();
    // Последний шаг остаётся на экране
    expect(current()).toBe("A1 → B1");
  });

  // Кнопки и клавиши навигации
  it("назад/вперёд и клавиатура", () => {
    // Рисуем
    const { onStepChange } = setup();
    // «Вперёд»
    fireEvent.click(screen.getByRole("button", { name: "Вперёд" }));
    // Второй шаг
    expect(current()).toBe("C1 → A31");
    // Стрелка вправо
    fireEvent.keyDown(window, { key: "ArrowRight" });
    // Третий шаг
    expect(current()).toBe("A31 → C31");
    // Стрелка влево
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    // «Назад»
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    // Снова первый
    expect(current()).toBe("A1 → C1");
    // Назад с первого шага нельзя
    expect(screen.getByRole("button", { name: "Назад" })).toBeDisabled();
    // Четыре перехода
    expect(onStepChange).toHaveBeenCalledTimes(4);

    // Стрелка вверх — быстрее
    fireEvent.keyDown(window, { key: "ArrowUp" });
    // Скорость 1,9
    expect(screen.getByTestId("speed")).toHaveTextContent("1,9 с");
    // Пробел — старт
    fireEvent.keyDown(window, { code: "Space", key: " " });
    // Кнопка теперь «Пауза»
    expect(screen.getByRole("button", { name: "Пауза" })).toBeInTheDocument();
  });

  // Переход к шагу по номеру
  it("переход к шагу по номеру с ограничением диапазона", () => {
    // Рисуем
    setup();
    // Вкладка «Управление»
    fireEvent.click(screen.getByRole("tab", { name: /Управление/ }));
    // Поле номера шага
    const input = screen.getByLabelText("Перейти к шагу");
    // Вводим 99 — больше, чем шагов
    fireEvent.change(input, { target: { value: "99" } });
    // «Перейти»
    fireEvent.click(screen.getByRole("button", { name: "Перейти" }));
    // Прижалось к последнему шагу
    expect(screen.getByTestId("step-counter")).toHaveTextContent("Шаг 5 из 5");
  });

  // Сколько лески уже натянуто
  it("показывает, сколько лески уже натянуто", () => {
    // Рисуем с шага 3
    setup({ initialStep: 3 });
    // до шага 3 натянуты две хорды через центр: 2 × 0,5 м
    expect(screen.getByTestId("thread-used")).toHaveTextContent("Уже натянуто 1,0 м");
  });
});
