"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { WeavePlayer } from "@/components/WeavePlayer";
import { useDebouncedPatch } from "@/hooks/useDebouncedPatch";
import { routes, useProjectId } from "@/lib/routes";
import { api, ApiError, type Project } from "@/lib/api";

export default function WeavePage() {
  return (
    <Suspense fallback={<p className="muted">Загружаем…</p>}>
      <WeavePageInner />
    </Suspense>
  );
}

function WeavePageInner() {
  const id = useProjectId();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const { schedule } = useDebouncedPatch(id, 300, (e) =>
    setSaveError(e instanceof ApiError ? e.message : "Шаг не сохранился — проверьте связь с сервером."),
  );

  useEffect(() => {
    api
      .get(id)
      .then(setProject)
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? "Проект не найден." : String(e.message)));
  }, [id]);

  if (error) {
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
  if (!project) return <p className="muted">Загружаем инструкцию…</p>;

  return (
    <div className="weave-page">
      <nav className="crumbs">
        <Link href={routes.project(project.id)}>{project.name}</Link>
      </nav>
      {saveError && (
        <p className="form-error" role="alert">
          {saveError}
        </p>
      )}
      <WeavePlayer
        sequence={project.sequence}
        totalSteps={project.line_count}
        diameterCm={project.diameter_cm}
        initialStep={project.current_step}
        initialSpeedSec={project.speed_sec}
        onStepChange={(s) => {
          setSaveError("");
          schedule({ current_step: s });
        }}
        onSpeedChange={(sec) => schedule({ speed_sec: sec })}
      />
    </div>
  );
}
