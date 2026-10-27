"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { PhotoControls, PhotoViewport } from "@/components/PhotoEditor";
import { useAutoPrep, usePhotoEditor } from "@/hooks/usePhotoEditor";
import { routes, useProjectId } from "@/lib/routes";
import { api, ApiError, type Features, type ImageInfo, type Project } from "@/lib/api";
import { num } from "@/lib/format";
import type { Prep } from "@/lib/prep";

export default function PhotoPage() {
  return (
    <Suspense fallback={<p className="muted">Загружаем…</p>}>
      <PhotoPageInner />
    </Suspense>
  );
}

function PhotoPageInner() {
  const id = useProjectId();
  const [project, setProject] = useState<Project | null>(null);
  const [info, setInfo] = useState<ImageInfo | null>(null);
  const [features, setFeatures] = useState<Features | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const p = await api.get(id);
        setProject(p);
        if (!p.image_id) {
          setError("У этого портрета не сохранилось исходное фото — создайте новый портрет.");
          return;
        }
        const [img, feats] = await Promise.all([api.image(p.image_id), api.features()]);
        setInfo(img);
        setFeatures(feats);
      } catch (e) {
        setError(e instanceof ApiError && e.status === 404 ? "Проект не найден." : "Не удалось загрузить фото.");
      }
    })();
  }, [id]);

  if (error) {
    return (
      <div className="page-empty">
        <p className="form-error" role="alert">
          {error}
        </p>
        <Link href={project ? routes.project(project.id) : "/"} className="btn secondary">
          Назад
        </Link>
      </div>
    );
  }
  if (!project || !info) return <p className="muted">Загружаем фото…</p>;
  return <Editor project={project} info={info} features={features} />;
}

function Editor({ project, info, features }: { project: Project; info: ImageInfo; features: Features | null }) {
  const router = useRouter();
  const editor = usePhotoEditor(info, project.prep as Partial<Prep>);
  const auto = useAutoPrep(info, features, editor, project.diameter_cm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await editor.flushMask();
      await api.updatePhoto(project.id, editor.prep);
      router.push(routes.project(project.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось пересчитать портрет.");
      setBusy(false);
    }
  };

  return (
    <div className="studio">
      <nav className="crumbs">
        <Link href={routes.project(project.id)}>{project.name}</Link>
      </nav>
      <section className="new-project" aria-labelledby="photo-title">
        <PhotoViewport info={info} image={editor.image} mask={editor.mask}
          maskVersion={editor.maskVersion}
          brush={{ ...editor.brush, tool: editor.tool, size: editor.brushSize }} prep={editor.prep} onChange={editor.setPrep} />
        <div className="inspector new-form">
          <h1 id="photo-title">Фото для портрета</h1>
          <PhotoControls
            info={info}
            features={features}
            prep={editor.prep}
            onChange={editor.setPrep}
            maskStatus={editor.maskStatus}
            maskError={editor.maskError}
            maskNote={editor.maskNote}
            brush={{
              tool: editor.tool,
              setTool: editor.setTool,
              size: editor.brushSize,
              setSize: editor.setBrushSize,
              canUndo: editor.canUndo,
              undo: editor.undo,
              edited: editor.maskEdited,
              reset: () => void editor.resetMask(),
            }}
            auto={auto}
          />
          {project.current_step > 1 && (
            <p className="warning" data-testid="progress-warning">
              Схема станет другой, поэтому плетение начнётся заново: сейчас вы на шаге{" "}
              {num(project.current_step)}.
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="new-actions">
            <button
              type="button"
              className="btn primary"
              onClick={save}
              disabled={busy || editor.maskStatus === "loading" || auto.busy}
            >
              {busy ? "Считаем линии…" : "Пересчитать портрет"}
            </button>
            <Link href={routes.project(project.id)} className="btn secondary">
              Отмена
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
