// Компонент работает в браузере
"use client";

// Ссылка Next.js
import Link from "next/link";
// Переход в студию после открытия файла
import { useRouter } from "next/navigation";
// Хуки React
import { useCallback, useEffect, useState } from "react";
// Адреса страниц
import { routes } from "@/lib/routes";
// API, тип ошибки, тип проекта
import { api, ApiError, type ProjectSummary } from "@/lib/api";
// Форматирование дат и чисел
import { date, num } from "@/lib/format";
// Иконки
import { Icon } from "./ui/Icon";

// Кольцо прогресса вокруг превью
function ProgressRing({ done, total }: { done: number; total: number }) {
  // Радиус
  const r = 48;
  // Длина окружности
  const len = 2 * Math.PI * r;
  // Доля выполненного 0..1
  const frac = total > 0 ? Math.min(1, done / total) : 0;
  // Разметка
  return (
    // Векторная картинка
    <svg className="card-ring" viewBox="0 0 100 100" aria-hidden="true">
      {/* Серая дорожка */}
      <circle cx="50" cy="50" r={r} className="card-ring-track" />
      {/* Цветная дуга прогресса */}
      <circle
        // Центр X
        cx="50"
        // Центр Y
        cy="50"
        // Радиус
        r={r}
        // Стиль
        className="card-ring-fill"
        // Пунктир: видимая часть = доля окружности, пропуск = вся окружность
        strokeDasharray={`${len * frac} ${len}`}
        // Начало дуги — сверху (поворот на −90°)
        transform="rotate(-90 50 50)"
      />
    </svg>
  );
}

// Список портретов на главной
export function ProjectList() {
  // Проекты (null — ещё загружаются)
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  // Ошибка
  const [error, setError] = useState("");
  // Идёт открытие файла проекта
  const [importing, setImporting] = useState(false);
  // Переходы между страницами
  const router = useRouter();

  // Открыть файл проекта: новый портрет со всем прогрессом → в студию
  const openFile = async (file: File | undefined, input: HTMLInputElement) => {
    // Файл не выбран
    if (!file) return;
    // Идёт открытие
    setImporting(true);
    // Сбросить ошибку
    setError("");
    // Запрос может не пройти
    try {
      // Отправляем файл
      const project = await api.importFile(file, file.name);
      // В студию нового портрета
      router.push(routes.project(project.id));
    // Ошибка (испорченный файл и т. п.)
    } catch (e) {
      // Текст
      setError(e instanceof ApiError ? e.message : "Не удалось открыть файл проекта.");
      // Можно выбрать другой файл
      setImporting(false);
    }
    // Тот же файл можно выбрать ещё раз
    input.value = "";
  };

  // Загрузить список
  const load = useCallback(async () => {
    // Сбросить ошибку
    setError("");
    // Запрос может не пройти
    try {
      // Загружаем
      setItems(await api.list());
    // Ошибка
    } catch (e) {
      // Текст ошибки
      setError(e instanceof ApiError ? e.message : "Не удалось загрузить проекты.");
    }
  // Создаётся один раз
  }, []);

  // При появлении
  useEffect(() => {
    // Загрузить
    void load();
  // При смене load
  }, [load]);

  // Разметка
  return (
    // Раздел
    <section className="projects" aria-labelledby="projects-title">
      {/* Заголовок и «Открыть файл проекта» */}
      <div className="projects-head">
        {/* Заголовок */}
        <h2 id="projects-title">Мои портреты</h2>
        {/* Кнопка-подпись к скрытому полю файла */}
        <label className="btn secondary small" data-testid="import-label">
          {/* Значок */}
          <Icon name="upload" size={16} />
          {/* Надпись */}
          {importing ? "Открываем…" : "Открыть файл .nitegraf"}
          {/* Скрытое поле выбора файла */}
          <input
            // Тип
            type="file"
            // Только файлы проекта (и JSON — на телефоне расширение могут не знать)
            accept=".nitegraf,application/json"
            // Спрятано, нажимают на подпись
            className="visually-hidden"
            // Метка для тестов
            data-testid="import-input"
            // Пока открываем — нельзя
            disabled={importing}
            // Выбран файл
            onChange={(e) => void openFile(e.target.files?.[0], e.target)}
          />
        </label>
      </div>
      {/* Ошибка с кнопкой «Повторить» */}
      {error && (
        // Блок ошибки
        <div className="form-error" role="alert">
          {/* Текст и пробел */}
          {error}{" "}
          {/* Кнопка повтора */}
          <button type="button" className="btn small" onClick={load}>
            {/* Надпись */}
            Повторить
          </button>
        </div>
      )}
      {/* Пока грузится */}
      {items === null && !error && <p className="muted">Загружаем…</p>}
      {/* Проектов нет */}
      {items?.length === 0 && (
        // Подсказка
        <p className="muted" data-testid="empty-projects">
          {/* Текст подсказки */}
          Здесь появятся ваши портреты. Загрузите фото в круг выше, чтобы сделать первый.
        </p>
      )}
      {/* Есть проекты */}
      {items && items.length > 0 && (
        // Список карточек
        <ul className="cards">
          {/* Карточка на каждый проект */}
          {items.map((p) => {
            // Сколько шагов пройдено
            const done = p.current_step - 1;
            // Разметка карточки
            return (
              // Элемент списка
              <li key={p.id}>
                {/* Ссылка на студию проекта */}
                <Link href={routes.project(p.id)} className="card" data-testid="project-card">
                  {/* Картинка и кольцо */}
                  <span className="card-art">
                    {/* Отключаем правило линтера: здесь обычный img проще (превью отдаёт наш API) */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {/* Превью 320 px; lazy — грузится, когда дошли до него прокруткой */}
                    <img src={api.previewUrl(p.id, 320)} alt="" loading="lazy" width={160} height={160} />
                    {/* Кольцо прогресса */}
                    <ProgressRing done={done} total={p.line_count} />
                  </span>
                  {/* Название */}
                  <span className="card-name">{p.name}</span>
                  {/* Прогресс */}
                  <span className="card-meta">
                    {/* «Шаг 120 из 3 000» или «Ещё не начат» */}
                    {done > 0 ? `Шаг ${num(p.current_step)} из ${num(p.line_count)}` : "Ещё не начат"}
                  </span>
                  {/* Диаметр и дата */}
                  <span className="card-meta">
                    {/* «50 см, 27 октября 2026 г.» */}
                    {num(p.diameter_cm, p.diameter_cm % 1 ? 1 : 0)} см, {date(p.created_at)}
                  </span>
                  {/* Цветной портрет: кружки цветов нитей */}
                  {(p.layers?.length ?? 1) > 1 && (
                    // Ряд кружков с подписью для диктора
                    <span className="card-threads" aria-label={`Нити: ${p.layers!.map((l) => l.name.toLowerCase()).join(", ")}`}>
                      {/* Кружок на каждую нить */}
                      {p.layers!.map((l) => (
                        // Кружок
                        <span key={l.index} className="swatch-dot small" style={{ background: l.hex }} aria-hidden="true" />
                      ))}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
