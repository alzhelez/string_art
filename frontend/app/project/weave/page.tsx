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
// Нити цветного портрета
import { boardColor, drawLayers, isMultiLayer, layerTitle, projectLayers } from "@/lib/layers";
// Числа по-русски
import { num } from "@/lib/format";

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
  // Какую нить плетём (у цветного портрета)
  const [layer, setLayer] = useState(0);
  // Сохранение через 300 мс после последнего изменения; ошибка — показать предупреждение
  const { schedule, flush } = useDebouncedPatch(id, 300, (e) =>
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
      .then((p) => {
        // Проект
        setProject(p);
        // Нить, на которой остановились
        setLayer(Math.min(p.current_layer ?? 0, projectLayers(p).length - 1));
      })
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

  // Нити портрета
  const layers = projectLayers(project);
  // Несколько нитей
  const multi = isMultiLayer(project);
  // Текущая нить
  const active = layers[layer];
  // Перейти к другой нити: сохранить прежнюю, запомнить выбор на сервере
  const switchLayer = async (i: number) => {
    // Отправить отложенное сохранение шага
    await flush();
    // Новая нить
    setLayer(i);
    // Запомнить на сервере
    schedule({ current_layer: i });
  };
  // Запомнить шаг нити в проекте (чтобы при возврате к нити продолжить с него)
  const rememberStep = (s: number) =>
    // Новый проект с изменённым шагом нужной нити
    setProject((p) => (p && p.layers ? { ...p, layers: p.layers.map((l, i) => (i === layer ? { ...l, current_step: s } : l)) } : p));

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
      {/* У цветного портрета — выбор нити */}
      {multi && (
        // Ряд нитей
        <div className="segmented-wide layer-tabs weave-layers" role="radiogroup" aria-label="Нить">
          {/* Кнопка на каждую нить */}
          {layers.map((l, i) => (
            // Кнопка
            <button key={l.index} type="button" role="radio" aria-checked={layer === i} onClick={() => void switchLayer(i)}>
              {/* Кружок цвета */}
              <span className="swatch-dot small" style={{ background: l.hex }} aria-hidden="true" />
              {/* Номер, цвет и прогресс */}
              {i + 1}. {l.name} · {num(l.current_step)}/{num(l.line_count)}
            </button>
          ))}
        </div>
      )}
      {/* Экран плетения; key — новая нить начинается со своего шага */}
      <WeavePlayer
        // Ключ: смена нити пересоздаёт экран
        key={layer}
        // Последовательность нити
        sequence={active.sequence}
        // Шагов
        totalSteps={active.line_count}
        // Диаметр
        diameterCm={project.diameter_cm}
        // С какого шага
        initialStep={active.current_step}
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
        spoolM={project.own_spool_m ?? threadStats(active.sequence, active.line_count, project.diameter_cm).spool_m}
        // Все нити — для схемы
        layers={multi ? drawLayers(project) : undefined}
        // Текущая нить
        activeLayer={multi ? layer : undefined}
        // Цвет доски
        boardColor={multi ? boardColor(project) : undefined}
        // Подпись нити
        layerLabel={multi ? layerTitle(project, layer) : undefined}
        // Следующая нить
        nextLayer={multi && layer + 1 < layers.length ? { label: layerTitle(project, layer + 1), go: () => void switchLayer(layer + 1) } : undefined}
        // Сменился шаг
        onStepChange={(s) => {
          // Скрыть прошлую ошибку
          setSaveError("");
          // Запомнить локально
          rememberStep(s);
          // Сохранить шаг (у цветного портрета — с номером нити)
          schedule(multi ? { layer, current_step: s } : { current_step: s });
        }}
        // Сменилась скорость — сохранить
        onSpeedChange={(sec) => schedule({ speed_sec: sec })}
      />
    </div>
  );
}
