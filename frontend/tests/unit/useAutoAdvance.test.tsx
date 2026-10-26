import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoAdvance } from "@/hooks/useAutoAdvance";

describe("useAutoAdvance", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("не тикает на паузе", () => {
    const tick = vi.fn();
    renderHook(() => useAutoAdvance(false, 2000, 1, tick));
    vi.advanceTimersByTime(10_000);
    expect(tick).not.toHaveBeenCalled();
  });

  it("тикает через интервал", () => {
    const tick = vi.fn();
    renderHook(() => useAutoAdvance(true, 2000, 1, tick));
    vi.advanceTimersByTime(1999);
    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(tick).toHaveBeenCalledOnce();
  });

  it("смена шага перезапускает таймер", () => {
    const tick = vi.fn();
    const { rerender } = renderHook(({ step }) => useAutoAdvance(true, 2000, step, tick), {
      initialProps: { step: 1 },
    });
    vi.advanceTimersByTime(1500);
    rerender({ step: 2 });
    vi.advanceTimersByTime(1500);
    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(tick).toHaveBeenCalledOnce();
  });
});
