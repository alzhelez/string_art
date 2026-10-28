// Компонент работает в браузере
"use client";

// Тип данных кривой сходства
import type { Similarity } from "@/lib/api";
// Пределы числа линий — края графика
import { MAX_LINES, MIN_LINES } from "@/lib/constants";
// Числа по-русски
import { num } from "@/lib/format";

/** Кривая «сходство с фото ↔ число линий»: где максимум и где сейчас ползунок. */
// График сходства
export function SimilarityChart({ data, lines }: { data: Similarity; lines: number }) {
  // Ширина системы координат
  const W = 320;
  // Высота
  const H = 72;
  // Отступ от краёв
  const pad = 4;
  // Все значения сходства
  const scores = data.curve.map((p) => p.score);
  // Минимум (низ графика)
  const lo = Math.min(...scores);
  // Максимум (верх графика)
  const hi = Math.max(...scores);
  // Число линий → X на графике
  const x = (n: number) => pad + ((n - MIN_LINES) / (MAX_LINES - MIN_LINES)) * (W - 2 * pad);
  // Сходство → Y (больше — выше); 1e-6 защищает от деления на ноль на плоской кривой
  const y = (s: number) => H - pad - ((s - lo) / Math.max(1e-6, hi - lo)) * (H - 2 * pad);
  // Линия графика в формате SVG-пути: M — начать, L — провести линию
  const path = data.curve.map((p, i) => `${i ? "L" : "M"}${x(p.lines).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ");
  // Заливка под линией: путь + спуск к низу + замыкание
  const area = `${path} L${x(MAX_LINES).toFixed(1)},${H} L${x(MIN_LINES).toFixed(1)},${H} Z`;
  // Точка кривой, ближайшая к текущему положению ползунка
  const current = data.curve.reduce((a, b) => (Math.abs(b.lines - lines) < Math.abs(a.lines - lines) ? b : a));

  // Разметка
  return (
    // figure с подписью; aria-label — описание для экранного диктора
    <figure className="sim-chart" aria-label={`График сходства с фото: лучшее при ${data.best_lines} линиях`}>
      {/* Сам график растягивается по ширине (preserveAspectRatio="none") */}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {/* Заливка под кривой */}
        <path d={area} className="sim-area" />
        {/* Кривая */}
        <path d={path} className="sim-line" />
        {/* Вертикальная черта — текущее число линий */}
        <line x1={x(lines)} x2={x(lines)} y1={0} y2={H} className="sim-cursor" />
        {/* Точка максимума */}
        <circle cx={x(data.best_lines)} cy={y(data.best_score)} r={3.5} className="sim-best" />
      </svg>
      {/* Подпись под графиком */}
      <figcaption>
        {/* Текущее сходство в процентах от лучшего */}
        <span data-testid="similarity-current">
          {/* Подпись, процент жирным и пояснение */}
          Сходство с фото: <strong>{pctText(relativeScore(current.score, data))}</strong> от лучшего
        </span>
        {/* Где лучшее */}
        <span className="muted">лучшее — при {num(data.best_lines)}</span>
      </figcaption>
    </figure>
  );
}

// Доля → «97,3 %»
export const pctText = (v: number) => `${num(v * 100, 1)} %`;

/**
 * Сходство относительно лучшей точки кривой (0..1). Абсолютное значение метрики
 * (корреляция деталей ~0,4–0,6) человеку ничего не говорит, а «97 % от лучшего» — понятно.
 */
// Относительное сходство
export function relativeScore(score: number, data: Similarity): number {
  // Делим на лучшее и ограничиваем 0..1; если лучшее ≤ 0 — считаем 0
  return data.best_score > 0 ? Math.max(0, Math.min(1, score / data.best_score)) : 0;
}
