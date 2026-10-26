"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Board } from "@/components/Board";
import { DiameterPicker } from "@/components/DiameterPicker";
import { useDebouncedPatch } from "@/hooks/useDebouncedPatch";
import { api, ApiError, type Project } from "@/lib/api";
import { MAX_LINES, MIN_LINES } from "@/lib/constants";
import { num } from "@/lib/format";
import { recommendedLines, spoolText, threadStats } from "@/lib/thread";

export default function StudioPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const [lines, setLines] = useState(0);
  const [diameter, setDiameter] = useState(0);
  const [name, setName] = useState("");
  const [downloading, setDownloading] = useState(false);
  const { schedule, flush } = useDebouncedPatch(id, 400, (e) =>
    setError(e instanceof ApiError ? e.message : "Не удалось сохранить изменения."),
  );

  useEffect(() => {
    api
      .get(id)
      .then((p) => {
        setProject(p);
        setLines(p.line_count);
        setDiameter(p.diameter_cm);
        setName(p.name);
      })
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? "Проект не найден." : String(e.message)));
  }, [id]);

  const stats = useMemo(
    () => (project ? threadStats(project.sequence, lines, diameter) : null),
    [project, lines, diameter],
  );

  if (error && !project) {
    return (
      <div className="studio-missing">
        <p className="form-error" role="alert">
          {error}
        </p>
        <Link href="/" className="btn ghost">
          К списку портретов
        </Link>
      </div>
    );
  }
  if (!project || !stats) return <p className="muted">Загружаем портрет…</p>;

  const recommended = recommendedLines(diameter);
  const progressStep = Math.min(project.current_step, lines);

  const downloadPdf = async () => {
    setDownloading(true);
    await flush();
    const a = document.createElement("a");
    // Имя файла задаёт бэкенд в Content-Disposition: «Инструкция — <название>.pdf».
    a.href = api.pdfUrl(project.id);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => setDownloading(false), 1500);
  };

  const remove = async () => {
    if (!window.confirm(`Удалить «${project.name}»? Прогресс плетения тоже удалится.`)) return;
    try {
      await api.remove(project.id);
      router.push("/");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось удалить проект.");
    }
  };

  return (
    <div className="studio">
      <nav className="crumbs">
        <Link href="/">Все портреты</Link>
      </nav>

      <div className="studio-grid">
        <div className="studio-board">
          <Board label={`Портрет «${name}», ${lines} линий`} sequence={project.sequence} lines={lines} diameterCm={diameter} />
          <p className="muted board-note">
            Превью для чёрной лески 0,2 мм на круге {num(diameter, diameter % 1 ? 1 : 0)} см. Чем меньше круг, тем
            плотнее выглядят те же линии.
          </p>
        </div>

        <div className="studio-panel">
          <input
            className="title-input"
            aria-label="Название портрета"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const v = name.trim();
              if (!v) setName(project.name);
              else if (v !== project.name) {
                schedule({ name: v });
                setProject({ ...project, name: v });
              }
            }}
          />

          <DiameterPicker
            value={diameter}
            onChange={(cm) => {
              setDiameter(cm);
              schedule({ diameter_cm: cm });
            }}
          />

          <div className="field lines-field">
            <div className="lines-head">
              <label htmlFor="lines">Количество линий</label>
              <output htmlFor="lines" data-testid="lines-value">
                {num(lines)}
              </output>
            </div>
            <input
              id="lines"
              type="range"
              min={MIN_LINES}
              max={MAX_LINES}
              step={100}
              value={lines}
              onChange={(e) => {
                const v = Number(e.target.value);
                setLines(v);
                schedule({ line_count: v });
              }}
            />
            <p className="hint">
              Для {num(diameter, diameter % 1 ? 1 : 0)} см рекомендуем {num(recommended)}.{" "}
              {lines !== recommended && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setLines(recommended);
                    schedule({ line_count: recommended });
                  }}
                >
                  Поставить {num(recommended)}
                </button>
              )}
            </p>
          </div>

          <dl className="stats" data-testid="stats">
            <div>
              <dt>Шагов в инструкции</dt>
              <dd data-testid="stat-steps">{num(stats.steps)}</dd>
            </div>
            <div>
              <dt>Леска без запаса</dt>
              <dd>{num(stats.raw_length_m, 1)} м</dd>
            </div>
            <div>
              <dt>С запасом 15 %</dt>
              <dd data-testid="stat-total">{num(stats.total_length_m, 1)} м</dd>
            </div>
            <div className="stat-key">
              <dt>Минимальная катушка</dt>
              <dd data-testid="stat-spool">{spoolText(stats)}</dd>
            </div>
            <div>
              <dt>Шаг между гвоздями по дуге</dt>
              <dd data-testid="stat-spacing">{num(stats.nail_spacing_mm, 2)} мм</dd>
            </div>
          </dl>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <div className="studio-actions">
            <Link
              href={`/projects/${project.id}/weave`}
              className="btn primary"
              onClick={() => void flush()}
              data-testid="start-weaving"
            >
              {progressStep > 1 ? `Продолжить с шага ${num(progressStep)}` : "Начать плетение"}
            </Link>
            <button type="button" className="btn ghost" onClick={downloadPdf} disabled={downloading}>
              {downloading ? "Готовим PDF…" : "Скачать инструкцию PDF"}
            </button>
          </div>

          {project.image_id && (
            <p className="photo-edit-link">
              <Link href={`/projects/${project.id}/photo`} data-testid="edit-photo">
                Изменить фото: кадр, яркость, лицо, фон
              </Link>
            </p>
          )}

          <details className="source">
            <summary>Исходное фото после обработки</summary>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={api.sourceUrl(project.id)} alt="Исходное фото в оттенках серого" width={200} height={200} />
          </details>

          <button type="button" className="btn danger-link" onClick={remove}>
            Удалить портрет
          </button>
        </div>
      </div>
    </div>
  );
}
