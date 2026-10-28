// Пределы и шаг скорости автоперелистывания (общие с бэкендом)
import { MAX_SPEED_SEC, MIN_SPEED_SEC, SPEED_STEP_SEC } from "./constants";

/** Округляем до десятых, чтобы 2.0 - 0.1 - 0.1 давало 1.8, а не 1.7999999. */
// Привести скорость к допустимой: округлить и ограничить пределами
export function clampSpeed(sec: number): number {
  // Округление до десятых (дробные числа в компьютере неточны: 0.1 + 0.2 ≠ 0.3)
  const rounded = Math.round(sec * 10) / 10;
  // Не меньше минимума и не больше максимума
  return Math.min(MAX_SPEED_SEC, Math.max(MIN_SPEED_SEC, rounded));
}

/** Быстрее = меньше секунд на шаг. */
// Кнопка «быстрее»: на 0,1 с меньше
export const faster = (sec: number) => clampSpeed(sec - SPEED_STEP_SEC);
// Кнопка «медленнее»: на 0,1 с больше
export const slower = (sec: number) => clampSpeed(sec + SPEED_STEP_SEC);

// Можно ли ещё ускориться (иначе кнопка «быстрее» неактивна)
export const canGoFaster = (sec: number) => clampSpeed(sec) > MIN_SPEED_SEC;
// Можно ли ещё замедлиться
export const canGoSlower = (sec: number) => clampSpeed(sec) < MAX_SPEED_SEC;
