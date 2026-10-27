"use client";

import type { Similarity } from "@/lib/api";
import { MAX_LINES, MIN_LINES } from "@/lib/constants";
import { num } from "@/lib/format";

/** Кривая «сходство с фото ↔ число линий»: где максимум и где сейчас ползунок. */
export function SimilarityChart({ data, lines }: { data: Similarity; lines: number }) {
  const W = 320;
  const H = 72;
  const pad = 4;
  const scores = data.curve.map((p) => p.score);
  const lo = Math.min(...scores);
  const hi = Math.max(...scores);
  const x = (n: number) => pad + ((n - MIN_LINES) / (MAX_LINES - MIN_LINES)) * (W - 2 * pad);
  const y = (s: number) => H - pad - ((s - lo) / Math.max(1e-6, hi - lo)) * (H - 2 * pad);
  const path = data.curve.map((p, i) => `${i ? "L" : "M"}${x(p.lines).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ");
  const area = `${path} L${x(MAX_LINES).toFixed(1)},${H} L${x(MIN_LINES).toFixed(1)},${H} Z`;
  const current = data.curve.reduce((a, b) => (Math.abs(b.lines - lines) < Math.abs(a.lines - lines) ? b : a));

  return (
    <figure className="sim-chart" aria-label={`График сходства с фото: лучшее при ${data.best_lines} линиях`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={area} className="sim-area" />
        <path d={path} className="sim-line" />
        <line x1={x(lines)} x2={x(lines)} y1={0} y2={H} className="sim-cursor" />
        <circle cx={x(data.best_lines)} cy={y(data.best_score)} r={3.5} className="sim-best" />
      </svg>
      <figcaption>
        <span data-testid="similarity-current">
          Сходство с фото: <strong>{pctText(relativeScore(current.score, data))}</strong> от лучшего
        </span>
        <span className="muted">лучшее — при {num(data.best_lines)}</span>
      </figcaption>
    </figure>
  );
}

export const pctText = (v: number) => `${num(v * 100, 1)} %`;

/**
 * Сходство относительно лучшей точки кривой (0..1). Абсолютное значение метрики
 * (корреляция деталей ~0,4–0,6) человеку ничего не говорит, а «97 % от лучшего» — понятно.
 */
export function relativeScore(score: number, data: Similarity): number {
  return data.best_score > 0 ? Math.max(0, Math.min(1, score / data.best_score)) : 0;
}
