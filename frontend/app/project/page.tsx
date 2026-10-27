"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { SharePanel } from "@/components/studio/SharePanel";
import { SpoolPlanner } from "@/components/studio/SpoolPlanner";
import { StageView } from "@/components/studio/StageView";
import { DiameterPicker } from "@/components/DiameterPicker";
import { SimilarityChart } from "@/components/SimilarityChart";
import { Section, Slider } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { useDebouncedPatch } from "@/hooks/useDebouncedPatch";
import { routes, useProjectId } from "@/lib/routes";
import { api, ApiError, type Project, type Similarity } from "@/lib/api";
import { MAX_LINES, MIN_LINES } from "@/lib/constants";
import { num } from "@/lib/format";
import { spoolText, threadStats } from "@/lib/thread";

export default function StudioPage() {
  return (
    <Suspense fallback={<p className="muted">Загружаем…</p>}>
      <StudioPageInner />
    </Suspense>
  );
}

function StudioPageInner() {
  const id = useProjectId();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const [lines, setLines] = useState(0);
  const [diameter, setDiameter] = useState(0);
  const [name, setName] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [similarity, setSimilarity] = useState<Similarity | null>(null);
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

  // Рекомендация зависит от диаметра (та же леска на маленьком круге темнее) — пересчитываем при его смене.
  useEffect(() => {
    if (!project || !diameter) return;
    let alive = true;
    const t = setTimeout(() => {
      api
        .similarity(project.id, diameter)
        .then((s) => alive && setSimilarity(s))
        .catch(() => alive && setSimilarity(null));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [project, diameter]);

  const stats = useMemo(
    () => (project ? threadStats(project.sequence, lines, diameter) : null),
    [project, lines, diameter],
  );

  if (error && !project) {
    return (
      <div className="page-empty">
        <p className="form-error" role="alert">
          {error}
        </p>
        <Link href="/" className="btn secondary">
          К списку портретов
        </Link>
      </div>
    );
  }
  if (!project || !stats) return <p className="muted page-loading">Загружаем портрет…</p>;

  const progressStep = Math.min(project.current_step, lines);
  const recommended = similarity?.best_lines;
  const setLineCount = (v: number) => {
    setLines(v);
    schedule({ line_count: v });
  };

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
        <Link href="/">
          <Icon name="arrowLeft" size={16} /> Все портреты
        </Link>
      </nav>

      <div className="studio-grid">
        <div className="stage">
          <StageView
            sequence={project.sequence}
            lines={lines}
            diameterCm={diameter}
            name={name}
            photoUrl={api.sourceUrl(project.id)}
          />
          <p className="stage-note">
            Превью для чёрной лески 0,2 мм на круге {num(diameter, diameter % 1 ? 1 : 0)} см
          </p>
        </div>

        <div className="inspector">
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

          <div className="cta-row">
            <Link
              href={routes.weave(project.id)}
              className="btn primary"
              onClick={() => void flush()}
              data-testid="start-weaving"
            >
              <Icon name="play" size={18} />
              {progressStep > 1 ? `Продолжить с шага ${num(progressStep)}` : "Начать плетение"}
            </Link>
            <button type="button" className="btn secondary" onClick={downloadPdf} disabled={downloading}>
              <Icon name="download" size={18} />
              {downloading ? "Готовим PDF…" : "Скачать инструкцию PDF"}
            </button>
          </div>

          <Section title="Размер">
            <DiameterPicker
              value={diameter}
              onChange={(cm) => {
                setDiameter(cm);
                schedule({ diameter_cm: cm });
              }}
            />
          </Section>

          <Section title="Линии">
            <Slider
              id="lines"
              label="Количество линий"
              min={MIN_LINES}
              max={MAX_LINES}
              step={100}
              value={lines}
              display={num(lines)}
              testId="lines-value"
              onChange={setLineCount}
            >
              {similarity && <SimilarityChart data={similarity} lines={lines} />}
              <p className="hint" data-testid="recommendation">
                {recommended === undefined ? (
                  "Считаем, при каком количестве линий картина больше всего похожа на фото…"
                ) : (
                  <>
                    Рекомендуем <strong>{num(recommended)}</strong> — при этом количестве картина больше всего похожа на
                    фото: черты лица уже чёткие, а тон ещё не ушёл в черноту.{" "}
                    {lines !== recommended && (
                      <button type="button" className="link-btn" onClick={() => setLineCount(recommended)}>
                        Поставить {num(recommended)}
                      </button>
                    )}
                  </>
                )}
              </p>
            </Slider>
          </Section>

          <Section title="Леска">
            <dl className="stats" data-testid="stats">
              <div className="stat-key">
                <dt>Минимальная катушка</dt>
                <dd data-testid="stat-spool">{spoolText(stats)}</dd>
              </div>
              <div>
                <dt>С запасом 15 %</dt>
                <dd data-testid="stat-total">{num(stats.total_length_m, 1)} м</dd>
              </div>
              <div>
                <dt>Без запаса</dt>
                <dd>{num(stats.raw_length_m, 1)} м</dd>
              </div>
              <div>
                <dt>Шагов в инструкции</dt>
                <dd data-testid="stat-steps">{num(stats.steps)}</dd>
              </div>
              <div>
                <dt>Гвозди по дуге через</dt>
                <dd data-testid="stat-spacing">{num(stats.nail_spacing_mm, 2)} мм</dd>
              </div>
            </dl>
            <SpoolPlanner
              sequence={project.sequence}
              lines={lines}
              diameterCm={diameter}
              standardSpoolM={stats.spool_m}
              ownSpoolM={project.own_spool_m}
              onChange={(m) => {
                setProject({ ...project, own_spool_m: m });
                schedule({ own_spool_m: m });
              }}
            />
          </Section>

          <Section title="Распечатать и поделиться">
            <SharePanel
              projectId={project.id}
              name={name}
              sequence={project.sequence}
              lines={lines}
              diameterCm={diameter}
              threadM={stats.raw_length_m}
              beforeDownload={flush}
            />
          </Section>

          <Section title="Фото">
            <div className="photo-row">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="photo-thumb" src={api.sourceUrl(project.id)} alt="Фото после обработки" width={72} height={72} />
              {project.image_id ? (
                <Link href={routes.photo(project.id)} className="btn secondary small" data-testid="edit-photo">
                  <Icon name="image" size={18} />
                  Изменить фото
                </Link>
              ) : (
                <span className="muted">Исходное фото не сохранилось</span>
              )}
            </div>
          </Section>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <button type="button" className="btn danger-ghost small" onClick={remove}>
            <Icon name="trash" size={16} />
            Удалить портрет
          </button>
        </div>
      </div>
    </div>
  );
}
