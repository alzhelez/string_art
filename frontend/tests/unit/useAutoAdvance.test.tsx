// renderHook запускает хук вне компонента
import { renderHook } from "@testing-library/react";
// Описание тестов, хуки до/после, проверки и подмена таймеров
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Тестируемый хук: автоматически переходит к следующему шагу
import { useAutoAdvance } from "@/hooks/useAutoAdvance";

// Группа тестов хука
describe("useAutoAdvance", () => {
  // Перед каждым тестом включаем искусственное время
  beforeEach(() => vi.useFakeTimers());
  // После — возвращаем настоящее
  afterEach(() => vi.useRealTimers());

  // На паузе шаги не переключаются
  it("не тикает на паузе", () => {
    // Шпион вместо функции «следующий шаг»
    const tick = vi.fn();
    // Хук на паузе, интервал 2 с
    renderHook(() => useAutoAdvance(false, 2000, 1, tick));
    // Проматываем 10 секунд
    vi.advanceTimersByTime(10_000);
    // Ни одного вызова
    expect(tick).not.toHaveBeenCalled();
  });

  // При воспроизведении — вызов ровно через интервал
  it("тикает через интервал", () => {
    // Шпион
    const tick = vi.fn();
    // Хук играет, интервал 2 с
    renderHook(() => useAutoAdvance(true, 2000, 1, tick));
    // Проматываем почти 2 секунды
    vi.advanceTimersByTime(1999);
    // Ещё рано
    expect(tick).not.toHaveBeenCalled();
    // Ещё 1 мс — ровно 2 секунды
    vi.advanceTimersByTime(1);
    // Ровно один вызов
    expect(tick).toHaveBeenCalledOnce();
  });

  // Ручной переход на другой шаг начинает отсчёт заново
  it("смена шага перезапускает таймер", () => {
    // Шпион
    const tick = vi.fn();
    // Хук с параметром «номер шага»
    const { rerender } = renderHook(({ step }) => useAutoAdvance(true, 2000, step, tick), {
      // Начинаем с шага 1
      initialProps: { step: 1 },
    });
    // Прошло 1,5 с
    vi.advanceTimersByTime(1500);
    // Пользователь сам перешёл на шаг 2
    rerender({ step: 2 });
    // Ещё 1,5 с — в сумме 3, но с момента смены только 1,5
    vi.advanceTimersByTime(1500);
    // Вызова нет — таймер перезапустился
    expect(tick).not.toHaveBeenCalled();
    // Ещё 0,5 с — 2 секунды после смены шага
    vi.advanceTimersByTime(500);
    // Теперь один вызов
    expect(tick).toHaveBeenCalledOnce();
  });
});
