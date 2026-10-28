// Страница работает в браузере
"use client";

// Ссылка Next.js
import Link from "next/link";
// Suspense — ожидание чтения адреса; хуки React
import { Suspense, useEffect, useState } from "react";
// Экран плетения
import { WeavePlayer } from "@/components/WeavePlayer";
// Отложенное сохранение шага и скорости
import { useDebouncedPatch } from "@/hooks/useDebouncedPatch";
// Адреса и id проекта из адреса
import { routes, useProjectId } from "@/lib/routes";
// API, тип ошибки, тип проекта
import { api, ApiError, type Project } from "@/lib/api";
// Расчёт лески (для стандартной катушки)
import { threadStats } from "@/lib/thread";

// Страница плетения (адрес /project/weave?id=…)
export default function WeavePage() {
  // Разметка
  return (
    // useSearchParams требует Suspense при статической сборке; пока ждём — «Загружаем…»
    <Suspense fallback={<p className="muted">Загружаем…</p>}>
      {/* Содержимое страницы */}
      <WeavePageInner />
    </Suspense>
  );
}

// Содержимое страницы
function WeavePageInner() {
  // id проекта из адреса
  const id = useProjectId();
  // Проект
  const [project, setProject] = useState<Project | null>(null);
  // Ошибка загрузки
  const [error, setError] = useState("");
  // Ошибка сохранения
  const [saveError, setSaveError] = useState("");
  // Сохранение через 300 мс после последнего изменения; ошибка — показать предупреждение
  const { schedule } = useDebouncedPatch(id, 300, (e) =>
    // Текст ошибки
    setSaveError(e instanceof ApiError ? e.message : "Шаг не сохранился — проверьте связь с сервером."),
  );

  // Загружаем проект
  useEffect(() => {
    // Запрос
    api
      // По id
      .get(id)
      // Успех — в состояние
      .then(setProject)
      // Ошибка: «не найден» или текст
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? "Проект не найден." : String(e.message)));
  // При смене id
  }, [id]);

  // Ошибка
  if (error) {
    // Разметка ошибки
    return (
      // Блок
      <div className="page-empty">
        {/* Текст ошибки */}
        <p className="form-error" role="alert">
          {/* Содержимое */}
          {error}
        </p>
        {/* Ссылка на главную */}
        <Link href="/" className="btn secondary">
          {/* Надпись */}
          К списку портретов
        </Link>
      </div>
    );
  }
  // Ещё грузится
  if (!project) return <p className="muted">Загружаем инструкцию…</p>;

  // Разметка
  return (
    // Страница
    <div className="weave-page">
      {/* Ошибка сохранения */}
      {saveError && (
        // Абзац
        <p className="form-error" role="alert">
          {/* Текст */}
          {saveError}
        </p>
      )}
      {/* Экран плетения */}
      <WeavePlayer
        // Последовательность
        sequence={project.sequence}
        // Шагов
        totalSteps={project.line_count}
        // Диаметр
        diameterCm={project.diameter_cm}
        // С какого шага
        initialStep={project.current_step}
        // Скорость
        initialSpeedSec={project.speed_sec}
        // Название
        title={project.name}
        // Ссылка назад — в студию
        backHref={routes.project(project.id)}
        // id для учёта времени
        projectId={project.id}
        // Журнал времени
        activity={project.activity}
        // Катушка: своя или стандартная из расчёта
        spoolM={project.own_spool_m ?? threadStats(project.sequence, project.line_count, project.diameter_cm).spool_m}
        // Сменился шаг
        onStepChange={(s) => {
          // Скрыть прошлую ошибку
          setSaveError("");
          // Сохранить шаг
          schedule({ current_step: s });
        }}
        // Сменилась скорость — сохранить
        onSpeedChange={(sec) => schedule({ speed_sec: sec })}
      />
    </div>
  );
}
