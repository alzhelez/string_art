// Сколько осталось плести и когда закончите — по реальному темпу человека.
// Тип журнала времени
import type { Activity } from "./api";
// Числа по-русски
import { num } from "./format";

/** Пока шагов мало, темп ненадёжен — считаем по скорости автоперелистывания. */
// Порог: после 30 шагов доверяем замеру
export const MIN_STEPS_FOR_PACE = 30;

// Секунд на шаг: по замеру или по настройке скорости
export function secPerStep(activity: Pick<Activity, "total_sec" | "total_steps">, speedSec: number): number {
  // Достаточно данных — средний темп, иначе — скорость автоперелистывания
  return activity.total_steps >= MIN_STEPS_FOR_PACE ? activity.total_sec / activity.total_steps : speedSec;
}

/** «3 ч 40 мин», «25 мин», «меньше минуты». */
// Длительность словами
export function duration(sec: number): string {
  // Минуты с округлением
  const minutes = Math.round(sec / 60);
  // Меньше минуты
  if (minutes < 1) return "меньше минуты";
  // Часы
  const h = Math.floor(minutes / 60);
  // Остаток минут
  const m = minutes % 60;
  // Меньше часа — только минуты
  if (!h) return `${m} мин`;
  // Часы и минуты (или ровно часы)
  return m ? `${num(h)} ч ${m} мин` : `${num(h)} ч`;
}

/** Среднее время плетения в день (по дням, когда плели, последние 14). */
// Обычное время плетения в день
export function dailyAverageSec(activity: Pick<Activity, "days">): number {
  // Дни, когда плели хотя бы минуту; последние 14 таких
  const days = activity.days.filter((d) => d.sec >= 60).slice(-14);
  // Среднее (или 0, если дней нет)
  return days.length ? days.reduce((s, d) => s + d.sec, 0) / days.length : 0;
}

// Прогноз окончания
export interface Eta {
  // Сколько шагов осталось
  remainingSteps: number;
  // Сколько секунд осталось
  remainingSec: number;
  // Секунд на шаг
  paceSec: number;
  /** Темп по данным человека, а не по настройке скорости. */
  measured: boolean;
  /** Примерная дата окончания при обычном темпе в день; null — данных мало. */
  finishDate: Date | null;
  // Обычное время в день, с
  dailySec: number;
}

// Посчитать прогноз
export function estimate(
  // Журнал времени
  activity: Activity,
  // Скорость автоперелистывания
  speedSec: number,
  // Текущий шаг
  step: number,
  // Всего шагов
  totalSteps: number,
  // «Сегодня» (тесты подставляют свою дату)
  today: Date = new Date(),
// Возвращает прогноз
): Eta {
  // Осталось шагов, включая текущий
  const remainingSteps = Math.max(0, totalSteps - step + 1);
  // Темп
  const paceSec = secPerStep(activity, speedSec);
  // Осталось времени
  const remainingSec = remainingSteps * paceSec;
  // Обычное время в день
  const dailySec = dailyAverageSec(activity);
  // Дата окончания (по умолчанию неизвестна)
  let finishDate: Date | null = null;
  // Есть привычка плести хотя бы 5 минут в день
  if (dailySec >= 300 && activity.days.length >= 1) {
    // Сколько ещё дней понадобится (сегодня — день 0)
    const days = Math.max(0, Math.ceil(remainingSec / dailySec) - 1);
    // Дата: сегодня + days дней
    finishDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  }
  // Прогноз
  return { remainingSteps, remainingSec, paceSec, measured: activity.total_steps >= MIN_STEPS_FOR_PACE, finishDate, dailySec };
}

/** Местная дата ГГГГ-ММ-ДД (для учёта времени по дням). */
// Сегодняшняя дата у человека (не UTC)
export function localDay(d: Date = new Date()): string {
  // Дополнить число нулём слева до двух цифр
  const p = (n: number) => String(n).padStart(2, "0");
  // Месяцы в JS считаются с 0 — прибавляем 1
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Дата окончания словами
export function finishText(date: Date, today: Date = new Date()): string {
  // Разница в днях между датой и началом сегодняшнего дня (86 400 000 мс в сутках)
  const days = Math.round((date.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
  // Сегодня или раньше
  if (days <= 0) return "сегодня";
  // Завтра
  if (days === 1) return "завтра";
  // Иначе — «пятница, 30 октября»
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "long" });
}
