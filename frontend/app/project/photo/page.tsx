// Страница работает в браузере
"use client";

// Ссылка Next.js
import Link from "next/link";
// Переход из кода
import { useRouter } from "next/navigation";
// Suspense и хуки React
import { Suspense, useEffect, useState } from "react";
// Окно кадра и панель настроек
import { PhotoControls, PhotoViewport } from "@/components/PhotoEditor";
// Хуки редактора и автонастройки
import { useAutoPrep, usePhotoEditor } from "@/hooks/usePhotoEditor";
// Адреса и id из адреса
import { routes, useProjectId } from "@/lib/routes";
// API и типы
import { api, ApiError, type Features, type ImageInfo, type Project } from "@/lib/api";
// Числа по-русски
import { num } from "@/lib/format";
// Тип настроек кадра
import type { Prep } from "@/lib/prep";

// Страница правки фото (адрес /project/photo?id=…)
export default function PhotoPage() {
  // Разметка
  return (
    // Ожидание чтения адреса
    <Suspense fallback={<p className="muted">Загружаем…</p>}>
      {/* Содержимое */}
      <PhotoPageInner />
    </Suspense>
  );
}

// Загрузка проекта и фото
function PhotoPageInner() {
  // id из адреса
  const id = useProjectId();
  // Проект
  const [project, setProject] = useState<Project | null>(null);
  // Фото
  const [info, setInfo] = useState<ImageInfo | null>(null);
  // Возможности сервера
  const [features, setFeatures] = useState<Features | null>(null);
  // Ошибка
  const [error, setError] = useState("");

  // Загружаем
  useEffect(() => {
    // Асинхронная функция
    (async () => {
      // Ошибки ловим
      try {
        // Проект
        const p = await api.get(id);
        // В состояние
        setProject(p);
        // У старых проектов нет оригинала
        if (!p.image_id) {
          // Сообщаем
          setError("У этого портрета не сохранилось исходное фото — создайте новый портрет.");
          // Выход
          return;
        }
        // Фото и возможности сервера параллельно
        const [img, feats] = await Promise.all([api.image(p.image_id), api.features()]);
        // Фото
        setInfo(img);
        // Возможности
        setFeatures(feats);
      // Ошибка
      } catch (e) {
        // Текст
        setError(e instanceof ApiError && e.status === 404 ? "Проект не найден." : "Не удалось загрузить фото.");
      }
    })();
  // При смене id
  }, [id]);

  // Ошибка
  if (error) {
    // Разметка
    return (
      // Блок
      <div className="page-empty">
        {/* Текст */}
        <p className="form-error" role="alert">
          {/* Содержимое */}
          {error}
        </p>
        {/* Ссылка назад: в студию или на главную */}
        <Link href={project ? routes.project(project.id) : "/"} className="btn secondary">
          {/* Надпись */}
          Назад
        </Link>
      </div>
    );
  }
  // Ещё грузится
  if (!project || !info) return <p className="muted">Загружаем фото…</p>;
  // Редактор
  return <Editor project={project} info={info} features={features} />;
}

// Редактор фото проекта
function Editor({ project, info, features }: { project: Project; info: ImageInfo; features: Features | null }) {
  // Переходы
  const router = useRouter();
  // Редактор с текущими настройками проекта
  const editor = usePhotoEditor(info, project.prep as Partial<Prep>);
  // Автонастройка
  const auto = useAutoPrep(info, features, editor, project.diameter_cm);
  // Идёт пересчёт
  const [busy, setBusy] = useState(false);
  // Ошибка
  const [error, setError] = useState("");

  // «Пересчитать портрет»
  const save = async () => {
    // Идёт работа
    setBusy(true);
    // Сброс ошибки
    setError("");
    // Ошибки ловим
    try {
      // Ждём отправки правок маски
      await editor.flushMask();
      // Новые настройки → пересчёт на сервере
      await api.updatePhoto(project.id, editor.prep);
      // Обратно в студию
      router.push(routes.project(project.id));
    // Ошибка
    } catch (e) {
      // Текст
      setError(e instanceof ApiError ? e.message : "Не удалось пересчитать портрет.");
      // Работа закончена
      setBusy(false);
    }
  };

  // Разметка
  return (
    // Страница
    <div className="studio">
      {/* «Хлебные крошки» */}
      <nav className="crumbs">
        {/* Ссылка на студию */}
        <Link href={routes.project(project.id)}>{project.name}</Link>
      </nav>
      {/* Секция редактора */}
      <section className="new-project" aria-labelledby="photo-title">
        {/* Окно кадра */}
        <PhotoViewport info={info} image={editor.image}
          // Ошибка загрузки фото и маска фона
          imageError={editor.imageError} mask={editor.mask}
          // Счётчик правок маски
          maskVersion={editor.maskVersion}
          // Кисть, настройки кадра и их изменение
          brush={{ ...editor.brush, tool: editor.tool, size: editor.brushSize }} prep={editor.prep} onChange={editor.setPrep} />
        {/* Правая колонка */}
        <div className="inspector new-form">
          {/* Заголовок */}
          <h1 id="photo-title">Фото для портрета</h1>
          {/* Панель настроек */}
          <PhotoControls
            // Фото
            info={info}
            // Возможности
            features={features}
            // Настройки
            prep={editor.prep}
            // Изменение
            onChange={editor.setPrep}
            // Состояние маски
            maskStatus={editor.maskStatus}
            // Ошибка
            maskError={editor.maskError}
            // Подсказка
            maskNote={editor.maskNote}
            // Кисть
            brush={{
              // Инструмент
              tool: editor.tool,
              // Сменить
              setTool: editor.setTool,
              // Размер
              size: editor.brushSize,
              // Сменить размер
              setSize: editor.setBrushSize,
              // Можно отменить
              canUndo: editor.canUndo,
              // Отменить
              undo: editor.undo,
              // Поправлена
              edited: editor.maskEdited,
              // Сбросить
              reset: () => void editor.resetMask(),
            }}
            // Автонастройка
            auto={auto}
          />
          {/* Предупреждение о сбросе прогресса */}
          {project.current_step > 1 && (
            // Абзац
            <p className="warning" data-testid="progress-warning">
              {/* Текст */}
              Схема станет другой, поэтому плетение начнётся заново: сейчас вы на шаге{" "}
              {num(project.current_step)}.
            </p>
          )}
          {/* Ошибка */}
          {error && (
            // Абзац
            <p className="form-error" role="alert">
              {/* Текст */}
              {error}
            </p>
          )}
          {/* Кнопки */}
          <div className="new-actions">
            {/* Пересчитать */}
            <button
              // Тип
              type="button"
              // Стиль
              className="btn primary"
              // Нажатие
              onClick={save}
              // Неактивна во время работы
              disabled={busy || editor.maskStatus === "loading" || auto.busy}
            >
              {/* Надпись */}
              {busy ? "Считаем линии…" : "Пересчитать портрет"}
            </button>
            {/* Отмена */}
            <Link href={routes.project(project.id)} className="btn secondary">
              {/* Надпись */}
              Отмена
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
