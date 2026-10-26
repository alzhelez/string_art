"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PhotoControls, PhotoViewport } from "@/components/PhotoEditor";
import { usePhotoEditor } from "@/hooks/usePhotoEditor";
import { api, ApiError, type Features, type ImageInfo, type Project } from "@/lib/api";
import { num } from "@/lib/format";
import type { Prep } from "@/lib/prep";

export default function PhotoPage() {
  const { id } = useParams<{ id: string }>();
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
      <div className="studio-missing">
        <p className="form-error" role="alert">
          {error}
        </p>
        <Link href={project ? `/projects/${project.id}` : "/"} className="btn ghost">
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await api.updatePhoto(project.id, editor.prep);
      router.push(`/projects/${project.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось пересчитать портрет.");
      setBusy(false);
    }
  };

  return (
    <div className="studio">
      <nav className="crumbs">
        <Link href={`/projects/${project.id}`}>{project.name}</Link>
      </nav>
      <section className="new-project" aria-labelledby="photo-title">
        <PhotoViewport info={info} image={editor.image} mask={editor.mask} prep={editor.prep} onChange={editor.setPrep} />
        <div className="new-form">
          <h1 id="photo-title">Фото для портрета</h1>
          <PhotoControls
            info={info}
            features={features}
            prep={editor.prep}
            onChange={editor.setPrep}
            maskStatus={editor.maskStatus}
            maskError={editor.maskError}
            maskNote={editor.maskNote}
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
              disabled={busy || editor.maskStatus === "loading"}
            >
              {busy ? "Считаем линии…" : "Пересчитать портрет"}
            </button>
            <Link href={`/projects/${project.id}`} className="btn ghost">
              Отмена
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
