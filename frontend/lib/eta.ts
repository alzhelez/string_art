// Сколько осталось плести и когда закончите — по реальному темпу человека.
import type { Activity } from "./api";
import { num } from "./format";

/** Пока шагов мало, темп ненадёжен — считаем по скорости автоперелистывания. */
export const MIN_STEPS_FOR_PACE = 30;

export function secPerStep(activity: Pick<Activity, "total_sec" | "total_steps">, speedSec: number): number {
  return activity.total_steps >= MIN_STEPS_FOR_PACE ? activity.total_sec / activity.total_steps : speedSec;
}

/** «3 ч 40 мин», «25 мин», «меньше минуты». */
export function duration(sec: number): string {
  const minutes = Math.round(sec / 60);
  if (minutes < 1) return "меньше минуты";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} мин`;
  return m ? `${num(h)} ч ${m} мин` : `${num(h)} ч`;
}

/** Среднее время плетения в день (по дням, когда плели, последние 14). */
export function dailyAverageSec(activity: Pick<Activity, "days">): number {
  const days = activity.days.filter((d) => d.sec >= 60).slice(-14);
  return days.length ? days.reduce((s, d) => s + d.sec, 0) / days.length : 0;
}

export interface Eta {
  remainingSteps: number;
  remainingSec: number;
  paceSec: number;
  /** Темп по данным человека, а не по настройке скорости. */
  measured: boolean;
  /** Примерная дата окончания при обычном темпе в день; null — данных мало. */
  finishDate: Date | null;
  dailySec: number;
}

export function estimate(
  activity: Activity,
  speedSec: number,
  step: number,
  totalSteps: number,
  today: Date = new Date(),
): Eta {
  const remainingSteps = Math.max(0, totalSteps - step + 1);
  const paceSec = secPerStep(activity, speedSec);
  const remainingSec = remainingSteps * paceSec;
  const dailySec = dailyAverageSec(activity);
  let finishDate: Date | null = null;
  if (dailySec >= 300 && activity.days.length >= 1) {
    const days = Math.max(0, Math.ceil(remainingSec / dailySec) - 1);
    finishDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  }
  return { remainingSteps, remainingSec, paceSec, measured: activity.total_steps >= MIN_STEPS_FOR_PACE, finishDate, dailySec };
}

/** Местная дата ГГГГ-ММ-ДД (для учёта времени по дням). */
export function localDay(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function finishText(date: Date, today: Date = new Date()): string {
  const days = Math.round((date.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
  if (days <= 0) return "сегодня";
  if (days === 1) return "завтра";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "long" });
}
