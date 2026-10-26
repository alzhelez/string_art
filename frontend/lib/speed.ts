import { MAX_SPEED_SEC, MIN_SPEED_SEC, SPEED_STEP_SEC } from "./constants";

/** Округляем до десятых, чтобы 2.0 - 0.1 - 0.1 давало 1.8, а не 1.7999999. */
export function clampSpeed(sec: number): number {
  const rounded = Math.round(sec * 10) / 10;
  return Math.min(MAX_SPEED_SEC, Math.max(MIN_SPEED_SEC, rounded));
}

/** Быстрее = меньше секунд на шаг. */
export const faster = (sec: number) => clampSpeed(sec - SPEED_STEP_SEC);
export const slower = (sec: number) => clampSpeed(sec + SPEED_STEP_SEC);

export const canGoFaster = (sec: number) => clampSpeed(sec) > MIN_SPEED_SEC;
export const canGoSlower = (sec: number) => clampSpeed(sec) < MAX_SPEED_SEC;
