"use client";

import type { Activity } from "@/lib/api";
import { duration, finishText, localDay, type Eta } from "@/lib/eta";
import { num } from "@/lib/format";

export const BREAK_OPTIONS = [0, 30, 45, 60, 90] as const;

/** Вкладка «Время»: сколько осталось, сколько уже сделано, перерывы. */
export function TimePanel({
  eta,
  activity,
  breakMin,
  setBreakMin,
}: {
  eta: Eta;
  activity: Activity;
  breakMin: number;
  setBreakMin: (m: number) => void;
}) {
  const today = activity.days.find((d) => d.date === localDay());
  const last = activity.days.slice(-7);
  const max = Math.max(1, ...last.map((d) => d.sec));
  return (
    <div className="time-panel">
      <dl className="time-stats">
        <div>
          <dt>Осталось</dt>
          <dd data-testid="eta-full">≈ {duration(eta.remainingSec)}</dd>
          <small>
            {num(eta.remainingSteps)} шагов по {num(eta.paceSec, 1)} с
            {eta.measured ? " — ваш темп" : " — пока по скорости перелистывания"}
          </small>
        </div>
        <div>
          <dt>Закончите</dt>
          <dd data-testid="eta-date">{eta.finishDate ? finishText(eta.finishDate) : "—"}</dd>
          <small>
            {eta.finishDate
              ? `если плести, как обычно, по ${duration(eta.dailySec)} в день`
              : "посчитаю, когда наберётся хотя бы 5 минут работы"}
          </small>
        </div>
        <div>
          <dt>Сегодня</dt>
          <dd>{today ? duration(today.sec) : "0 мин"}</dd>
          <small>{today ? `${num(today.steps)} шагов` : "ещё не начинали"}</small>
        </div>
        <div>
          <dt>Всего</dt>
          <dd>{duration(activity.total_sec)}</dd>
          <small>{num(activity.total_steps)} шагов</small>
        </div>
      </dl>

      {last.length > 0 && (
        <figure className="days-chart" aria-label="Время плетения по дням">
          {last.map((d) => (
            <div key={d.date} className="day">
              <span className="day-bar" style={{ height: `${Math.max(4, (d.sec / max) * 100)}%` }} title={duration(d.sec)} />
              <span className="day-label">{new Date(`${d.date}T12:00`).toLocaleDateString("ru-RU", { weekday: "short" })}</span>
            </div>
          ))}
        </figure>
      )}

      <div className="segmented-wide" role="radiogroup" aria-label="Напоминать о перерыве">
        {BREAK_OPTIONS.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={breakMin === m} onClick={() => setBreakMin(m)}>
            {m ? `${m} мин` : "Не напоминать"}
          </button>
        ))}
      </div>
      <small className="muted">Напоминание о перерыве — после стольких минут работы без остановки.</small>
    </div>
  );
}
