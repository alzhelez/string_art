"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { routes } from "@/lib/routes";
import { api, ApiError, type ProjectSummary } from "@/lib/api";
import { date, num } from "@/lib/format";

function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 48;
  const len = 2 * Math.PI * r;
  const frac = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <svg className="card-ring" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r={r} className="card-ring-track" />
      <circle
        cx="50"
        cy="50"
        r={r}
        className="card-ring-fill"
        strokeDasharray={`${len * frac} ${len}`}
        transform="rotate(-90 50 50)"
      />
    </svg>
  );
}

export function ProjectList() {
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setItems(await api.list());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось загрузить проекты.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="projects" aria-labelledby="projects-title">
      <h2 id="projects-title">Мои портреты</h2>
      {error && (
        <div className="form-error" role="alert">
          {error}{" "}
          <button type="button" className="btn small" onClick={load}>
            Повторить
          </button>
        </div>
      )}
      {items === null && !error && <p className="muted">Загружаем…</p>}
      {items?.length === 0 && (
        <p className="muted" data-testid="empty-projects">
          Здесь появятся ваши портреты. Загрузите фото в круг выше, чтобы сделать первый.
        </p>
      )}
      {items && items.length > 0 && (
        <ul className="cards">
          {items.map((p) => {
            const done = p.current_step - 1;
            return (
              <li key={p.id}>
                <Link href={routes.project(p.id)} className="card" data-testid="project-card">
                  <span className="card-art">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={api.previewUrl(p.id, 320)} alt="" loading="lazy" width={160} height={160} />
                    <ProgressRing done={done} total={p.line_count} />
                  </span>
                  <span className="card-name">{p.name}</span>
                  <span className="card-meta">
                    {done > 0 ? `Шаг ${num(p.current_step)} из ${num(p.line_count)}` : "Ещё не начат"}
                  </span>
                  <span className="card-meta">
                    {num(p.diameter_cm, p.diameter_cm % 1 ? 1 : 0)} см, {date(p.created_at)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
