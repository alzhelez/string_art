// Компонент работает в браузере
"use client";

// Тип журнала времени
import type { Activity } from "@/lib/api";
// Длительность словами, дата окончания, сегодняшняя дата, тип прогноза
import { duration, finishText, localDay, type Eta } from "@/lib/eta";
// Числа по-русски
import { num } from "@/lib/format";

// Варианты напоминания о перерыве в минутах (0 — не напоминать)
export const BREAK_OPTIONS = [0, 30, 45, 60, 90] as const;

/** Вкладка «Время»: сколько осталось, сколько уже сделано, перерывы. */
// Вкладка «Время»
export function TimePanel({
  // Прогноз
  eta,
  // Журнал
  activity,
  // Выбранный интервал перерыва
  breakMin,
  // Сменить интервал
  setBreakMin,
// Типы свойств
}: {
  // Прогноз
  eta: Eta;
  // Журнал
  activity: Activity;
  // Интервал
  breakMin: number;
  // Обработчик
  setBreakMin: (m: number) => void;
// Тело компонента
}) {
  // Запись за сегодня
  const today = activity.days.find((d) => d.date === localDay());
  // Последние 7 дней с работой
  const last = activity.days.slice(-7);
  // Самый долгий день — 100 % высоты столбика
  const max = Math.max(1, ...last.map((d) => d.sec));
  // Разметка
  return (
    // Панель
    <div className="time-panel">
      {/* Список «показатель — значение» */}
      <dl className="time-stats">
        {/* Осталось */}
        <div>
          {/* Подпись */}
          <dt>Осталось</dt>
          {/* Сколько времени осталось */}
          <dd data-testid="eta-full">≈ {duration(eta.remainingSec)}</dd>
          {/* Пояснение */}
          <small>
            {/* Шаги и темп */}
            {num(eta.remainingSteps)} шагов по {num(eta.paceSec, 1)} с
            {/* Откуда темп */}
            {eta.measured ? " — ваш темп" : " — пока по скорости перелистывания"}
          </small>
        </div>
        {/* Дата окончания */}
        <div>
          {/* Подпись */}
          <dt>Закончите</dt>
          {/* Дата или прочерк */}
          <dd data-testid="eta-date">{eta.finishDate ? finishText(eta.finishDate) : "—"}</dd>
          {/* Пояснение */}
          <small>
            {/* Есть дата? */}
            {eta.finishDate
              // Да — от какого темпа в день
              ? `если плести, как обычно, по ${duration(eta.dailySec)} в день`
              // Нет — почему
              : "посчитаю, когда наберётся хотя бы 5 минут работы"}
          </small>
        </div>
        {/* Сегодня */}
        <div>
          {/* Подпись */}
          <dt>Сегодня</dt>
          {/* Время за сегодня */}
          <dd>{today ? duration(today.sec) : "0 мин"}</dd>
          {/* Шаги за сегодня */}
          <small>{today ? `${num(today.steps)} шагов` : "ещё не начинали"}</small>
        </div>
        {/* Всего */}
        <div>
          {/* Подпись */}
          <dt>Всего</dt>
          {/* Время за всё время */}
          <dd>{duration(activity.total_sec)}</dd>
          {/* Шаги */}
          <small>{num(activity.total_steps)} шагов</small>
        </div>
      </dl>

      {/* График по дням (если есть данные) */}
      {last.length > 0 && (
        // Диаграмма
        <figure className="days-chart" aria-label="Время плетения по дням">
          {/* Столбик на каждый день */}
          {last.map((d) => (
            // День
            <div key={d.date} className="day">
              {/* Столбик; высота — доля от самого долгого дня (не меньше 4 %), подсказка — время */}
              <span className="day-bar" style={{ height: `${Math.max(4, (d.sec / max) * 100)}%` }} title={duration(d.sec)} />
              {/* День недели («пн»); T12:00 — середина дня, чтобы часовой пояс не сдвинул дату */}
              <span className="day-label">{new Date(`${d.date}T12:00`).toLocaleDateString("ru-RU", { weekday: "short" })}</span>
            </div>
          ))}
        </figure>
      )}

      {/* Выбор интервала перерыва */}
      <div className="segmented-wide" role="radiogroup" aria-label="Напоминать о перерыве">
        {/* Кнопка на каждый вариант */}
        {BREAK_OPTIONS.map((m) => (
          // Кнопка-переключатель
          <button key={m} type="button" role="radio" aria-checked={breakMin === m} onClick={() => setBreakMin(m)}>
            {/* «60 мин» или «Не напоминать» */}
            {m ? `${m} мин` : "Не напоминать"}
          </button>
        ))}
      </div>
      {/* Пояснение */}
      <small className="muted">Напоминание о перерыве — после стольких минут работы без остановки.</small>
    </div>
  );
}
