// Страница работает в браузере
"use client";

// Ссылка Next.js
import Link from "next/link";
// Переход из кода
import { useRouter } from "next/navigation";
// Suspense и хуки React
import { Suspense, useEffect, useMemo, useState } from "react";
// Панель «Распечатать и поделиться»
import { SharePanel } from "@/components/studio/SharePanel";
// Планировщик катушек
import { SpoolPlanner } from "@/components/studio/SpoolPlanner";
// Сцена: нити, сравнение, на стене
import { StageView } from "@/components/studio/StageView";
// Выбор диаметра
import { DiameterPicker } from "@/components/DiameterPicker";
// График сходства
import { SimilarityChart } from "@/components/SimilarityChart";
// Секция и ползунок
import { Section, Slider } from "@/components/ui/Controls";
// Иконки
import { Icon } from "@/components/ui/Icon";
// Отложенное сохранение
import { useDebouncedPatch } from "@/hooks/useDebouncedPatch";
// Адреса и id из адреса
import { routes, useProjectId } from "@/lib/routes";
// API и типы
import { api, ApiError, type Project, type Similarity } from "@/lib/api";
// Пределы числа линий
import { MAX_LINES, MIN_LINES } from "@/lib/constants";
// Числа по-русски
import { num } from "@/lib/format";
// Катушка текстом и расчёт лески
import { spoolText, threadStats } from "@/lib/thread";
// Нити цветного портрета: слои, цвета, доска, подписи
import { boardColor, drawLayers, isMultiLayer, layerTitle, projectLayers } from "@/lib/layers";
// Наименьшее число линий слоя цветного портрета
import { LAYER_MIN_LINES } from "@/lib/constants";

// Студия портрета (адрес /project?id=…)
export default function StudioPage() {
  // Разметка
  return (
    // Ожидание чтения адреса
    <Suspense fallback={<p className="muted">Загружаем…</p>}>
      {/* Содержимое */}
      <StudioPageInner />
    </Suspense>
  );
}

// Содержимое студии
function StudioPageInner() {
  // id из адреса
  const id = useProjectId();
  // Переходы
  const router = useRouter();
  // Проект
  const [project, setProject] = useState<Project | null>(null);
  // Ошибка
  const [error, setError] = useState("");
  // Число линий каждой нити (меняется ползунком мгновенно, сохраняется с задержкой)
  const [layerLines, setLayerLines] = useState<number[]>([]);
  // Какую нить настраивает ползунок
  const [layerIndex, setLayerIndex] = useState(0);
  // Число линий выбранной нити
  const lines = layerLines[layerIndex] ?? 0;
  // Диаметр
  const [diameter, setDiameter] = useState(0);
  // Название
  const [name, setName] = useState("");
  // Готовится PDF
  const [downloading, setDownloading] = useState(false);
  // Кривая сходства
  const [similarity, setSimilarity] = useState<Similarity | null>(null);
  // Сохранение изменений через 400 мс; ошибка — показать
  const { schedule, flush } = useDebouncedPatch(id, 400, (e) =>
    // Текст ошибки
    setError(e instanceof ApiError ? e.message : "Не удалось сохранить изменения."),
  );

  // Загрузка проекта
  useEffect(() => {
    // Запрос
    api
      // По id
      .get(id)
      // Успех
      .then((p) => {
        // Проект
        setProject(p);
        // Линии
        setLayerLines(projectLayers(p).map((l) => l.line_count));
        // Диаметр
        setDiameter(p.diameter_cm);
        // Название
        setName(p.name);
      })
      // Ошибка
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? "Проект не найден." : String(e.message)));
  // При смене id
  }, [id]);

  // Рекомендация зависит от диаметра (та же леска на маленьком круге темнее) — пересчитываем при его смене.
  // Кривая сходства для текущего диаметра
  useEffect(() => {
    // Нет данных
    if (!project || !diameter) return;
    // Флаг актуальности
    let alive = true;
    // Небольшая задержка — пока человек вводит диаметр, лишних запросов нет
    const t = setTimeout(() => {
      // Запрос
      api
        // Для диаметра
        .similarity(project.id, diameter, layerIndex)
        // Успех (если ещё актуально)
        .then((s) => alive && setSimilarity(s))
        // Ошибка — без графика
        .catch(() => alive && setSimilarity(null));
    // Задержка 250 мс
    }, 250);
    // При смене
    return () => {
      // Результат больше не нужен
      alive = false;
      // Отменить отложенный запрос
      clearTimeout(t);
    };
  // Зависимости
  }, [project, diameter, layerIndex]);

  // Расчёт лески пересчитывается мгновенно в браузере
  const stats = useMemo(
    // Если проект загружен
    () => (project && lines ? threadStats(projectLayers(project)[layerIndex].sequence, lines, diameter) : null),
    // Зависимости
    [project, lines, diameter, layerIndex],
  );

  // Ошибка и проекта нет
  if (error && !project) {
    // Разметка ошибки
    return (
      // Блок
      <div className="page-empty">
        {/* Текст */}
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
  if (!project || !stats) return <p className="muted page-loading">Загружаем портрет…</p>;

  // Нити портрета
  const layers = projectLayers(project);
  // Несколько нитей
  const multi = isMultiLayer(project);
  // Нить, которую сейчас плетут
  const weaveLayer = Math.min(project.current_layer ?? 0, layers.length - 1);
  // Пройденный шаг этой нити (если линий стало меньше — не больше их числа)
  const progressStep = Math.min(layers[weaveLayer].current_step, layerLines[weaveLayer] ?? lines);
  // Нити для рисования с текущими числами линий
  const drawn = multi ? drawLayers(project, Object.fromEntries(layerLines.map((n, i) => [i, n]))) : undefined;
  // Расчёт лески каждого цвета
  const layerStats = layers.map((l, i) => threadStats(l.sequence, layerLines[i] ?? l.line_count, diameter));
  // Вся леска без запаса (для открытки)
  const allRawM = layerStats.reduce((sum, st) => sum + st.raw_length_m, 0);
  // Рекомендуемое число линий
  const recommended = similarity?.best_lines;
  // Сменить число линий
  const setLineCount = (v: number) => {
    // Сразу в состояние
    setLayerLines((prev) => prev.map((n, i) => (i === layerIndex ? v : n)));
    // Сохранить с задержкой (у цветного портрета — с номером нити)
    schedule(multi ? { layer: layerIndex, line_count: v } : { line_count: v });
  };
  // Выбрать нить для ползунка: сначала сохранить изменения прежней
  const selectLayer = async (i: number) => {
    // Отправить отложенное
    await flush();
    // Новая нить
    setLayerIndex(i);
    // Кривую сходства пересчитаем для неё
    setSimilarity(null);
  };

  // Скачать PDF
  const downloadPdf = async () => {
    // Идёт подготовка
    setDownloading(true);
    // Сначала сохраняем изменения — PDF строится по сохранённым данным
    await flush();
    // Временная ссылка
    const a = document.createElement("a");
    // Имя файла задаёт бэкенд в Content-Disposition: «Инструкция — <название>.pdf».
    // Адрес PDF
    a.href = api.pdfUrl(project.id);
    // В документ
    document.body.appendChild(a);
    // «Нажать»
    a.click();
    // Убрать
    a.remove();
    // Через 1,5 с вернуть кнопку
    setTimeout(() => setDownloading(false), 1500);
  };

  // Удалить портрет
  const remove = async () => {
    // Спросить подтверждение
    if (!window.confirm(`Удалить «${project.name}»? Прогресс плетения тоже удалится.`)) return;
    // Ошибки ловим
    try {
      // Удалить
      await api.remove(project.id);
      // На главную
      router.push("/");
    // Ошибка
    } catch (e) {
      // Текст
      setError(e instanceof ApiError ? e.message : "Не удалось удалить проект.");
    }
  };

  // Разметка
  return (
    // Студия
    <div className="studio">
      {/* «Хлебные крошки» */}
      <nav className="crumbs">
        {/* Ссылка на главную */}
        <Link href="/">
          {/* Стрелка и текст */}
          <Icon name="arrowLeft" size={16} /> Все портреты
        </Link>
      </nav>

      {/* Сетка: сцена слева, настройки справа */}
      <div className="studio-grid">
        {/* Сцена */}
        <div className="stage">
          {/* Нити / сравнение / на стене */}
          <StageView
            // Последовательность
            sequence={layers[layerIndex].sequence}
            // Линии
            lines={lines}
            // Диаметр
            diameterCm={diameter}
            // Название
            name={name}
            // Фото для сравнения
            photoUrl={api.sourceUrl(project.id)}
            // Все нити цветного портрета
            layers={drawn}
            // Цвет доски
            boardColor={boardColor(project)}
          />
          {/* Пояснение под сценой */}
          <p className="stage-note">
            {/* Текст */}
            {multi
              // Несколько нитей
              ? `Превью: ${layers.length} нити по 0,2 мм на доске «${project.board?.name.toLowerCase() ?? "белая"}», круг ${num(diameter, diameter % 1 ? 1 : 0)} см`
              // Одна нить
              : `Превью для чёрной лески 0,2 мм на круге ${num(diameter, diameter % 1 ? 1 : 0)} см`}
          </p>
        </div>

        {/* Колонка настроек */}
        <div className="inspector">
          {/* Название — прямо поле ввода */}
          <input
            // Стиль
            className="title-input"
            // Описание
            aria-label="Название портрета"
            // Значение
            value={name}
            // Не длиннее 100 символов
            maxLength={100}
            // Ввод
            onChange={(e) => setName(e.target.value)}
            // Ушли из поля — сохраняем
            onBlur={() => {
              // Без пробелов по краям
              const v = name.trim();
              // Пусто — вернуть прежнее
              if (!v) setName(project.name);
              // Изменилось
              else if (v !== project.name) {
                // Сохранить
                schedule({ name: v });
                // Обновить проект (заголовок PDF и шаблона)
                setProject({ ...project, name: v });
              }
            }}
          />

          {/* Главные кнопки */}
          <div className="cta-row">
            {/* Начать/продолжить плетение */}
            <Link
              // Адрес
              href={routes.weave(project.id)}
              // Стиль
              className="btn primary"
              // Перед переходом сохранить изменения
              onClick={() => void flush()}
              // Метка для тестов
              data-testid="start-weaving"
            >
              {/* Значок */}
              <Icon name="play" size={18} />
              {/* Надпись */}
              {progressStep <= 1 && weaveLayer === 0
                // Ещё не начинали
                ? "Начать плетение"
                // Начинали —
                : multi
                  // — цветной портрет: нить и шаг
                  ? `Продолжить: нить ${weaveLayer + 1}, шаг ${num(progressStep)}`
                  // — одна нить: шаг
                  : `Продолжить с шага ${num(progressStep)}`}
            </Link>
            {/* Скачать PDF */}
            <button type="button" className="btn secondary" onClick={downloadPdf} disabled={downloading}>
              {/* Значок */}
              <Icon name="download" size={18} />
              {/* Надпись */}
              {downloading ? "Готовим PDF…" : "Скачать инструкцию PDF"}
            </button>
          </div>

          {/* Секция «Размер» */}
          <Section title="Размер">
            {/* Выбор диаметра */}
            <DiameterPicker
              // Значение
              value={diameter}
              // Изменение
              onChange={(cm) => {
                // Сразу в состояние
                setDiameter(cm);
                // Сохранить
                schedule({ diameter_cm: cm });
              }}
            />
          </Section>

          {/* Секция «Линии» */}
          <Section title="Линии">
            {/* У цветного портрета — выбор нити для ползунка */}
            {multi && (
              // Ряд нитей
              <div className="segmented-wide layer-tabs" role="radiogroup" aria-label="Нить">
                {/* Кнопка на каждую нить */}
                {layers.map((l, i) => (
                  // Кнопка
                  <button key={l.index} type="button" role="radio" aria-checked={layerIndex === i} onClick={() => void selectLayer(i)}>
                    {/* Кружок цвета */}
                    <span className="swatch-dot small" style={{ background: l.hex }} aria-hidden="true" />
                    {/* Номер и цвет */}
                    {i + 1}. {l.name}
                  </button>
                ))}
              </div>
            )}
            {/* Ползунок линий */}
            <Slider
              // id
              id="lines"
              // Подпись
              label={multi ? `Линий: ${layerTitle(project, layerIndex).toLowerCase()}` : "Количество линий"}
              // Минимум: у слоя цветного портрета — 100
              min={multi ? LAYER_MIN_LINES : MIN_LINES}
              // Максимум
              max={MAX_LINES}
              // Шаг 100
              step={100}
              // Значение
              value={lines}
              // Показ
              display={num(lines)}
              // Метка для тестов
              testId="lines-value"
              // Изменение
              onChange={setLineCount}
            >
              {/* График сходства */}
              {similarity && <SimilarityChart data={similarity} lines={lines} />}
              {/* Рекомендация */}
              <p className="hint" data-testid="recommendation">
                {/* Ещё считаем или уже знаем */}
                {recommended === undefined ? (
                  // Пока считаем
                  "Считаем, при каком количестве линий картина больше всего похожа на фото…"
                // Иначе
                ) : (
                  // Фрагмент
                  <>
                    {/* Рекомендация с пояснением */}
                    Рекомендуем <strong>{num(recommended)}</strong> —{" "}
                    {/* Пояснение для одной нити или для цветного портрета */}
                    {multi
                      // Цветной портрет
                      ? "при этом количестве линий этой нити картина целиком больше всего похожа на фото."
                      // Одна нить
                      : "при этом количестве картина больше всего похожа на фото: черты лица уже чёткие, а тон ещё не ушёл в черноту."}{" "}
                    {/* Кнопка «Поставить», если сейчас другое число */}
                    {lines !== recommended && (
                      // Кнопка-ссылка
                      <button type="button" className="link-btn" onClick={() => setLineCount(recommended)}>
                        {/* Надпись */}
                        Поставить {num(recommended)}
                      </button>
                    )}
                  </>
                )}
              </p>
            </Slider>
          </Section>

          {/* Секция «Леска» */}
          <Section title="Леска">
            {/* У цветного портрета — сколько лески каждого цвета */}
            {multi && (
              // Список нитей
              <ul className="layer-threads" data-testid="layer-threads">
                {/* Строка на каждую нить */}
                {layers.map((l, i) => (
                  // Строка
                  <li key={l.index}>
                    {/* Кружок цвета */}
                    <span className="swatch-dot small" style={{ background: l.hex }} aria-hidden="true" />
                    {/* Название */}
                    <span className="layer-name">{l.name}</span>
                    {/* Линии и длина с запасом */}
                    <span className="muted">
                      {/* «2 500 линий · 1 126,7 м» */}
                      {num(layerLines[i] ?? l.line_count)} линий · {num(layerStats[i].total_length_m, 1)} м
                    </span>
                    {/* Катушка */}
                    <strong>{spoolText(layerStats[i])}</strong>
                  </li>
                ))}
              </ul>
            )}
            {/* Список показателей */}
            <dl className="stats" data-testid="stats">
              {/* Катушка — выделена */}
              <div className="stat-key">
                {/* Подпись */}
                <dt>Минимальная катушка</dt>
                {/* Значение */}
                <dd data-testid="stat-spool">{spoolText(stats)}</dd>
              </div>
              {/* С запасом */}
              <div>
                {/* Подпись */}
                <dt>С запасом 15 %</dt>
                {/* Значение */}
                <dd data-testid="stat-total">{num(stats.total_length_m, 1)} м</dd>
              </div>
              {/* Без запаса */}
              <div>
                {/* Подпись */}
                <dt>Без запаса</dt>
                {/* Значение */}
                <dd>{num(stats.raw_length_m, 1)} м</dd>
              </div>
              {/* Шагов */}
              <div>
                {/* Подпись */}
                <dt>Шагов в инструкции</dt>
                {/* Значение */}
                <dd data-testid="stat-steps">{num(stats.steps)}</dd>
              </div>
              {/* Шаг гвоздей */}
              <div>
                {/* Подпись */}
                <dt>Гвозди по дуге через</dt>
                {/* Значение */}
                <dd data-testid="stat-spacing">{num(stats.nail_spacing_mm, 2)} мм</dd>
              </div>
            </dl>
            {/* Своя катушка */}
            <SpoolPlanner
              // Последовательность выбранной нити
              sequence={layers[layerIndex].sequence}
              // Линии
              lines={lines}
              // Диаметр
              diameterCm={diameter}
              // Стандартная катушка
              standardSpoolM={stats.spool_m}
              // Своя
              ownSpoolM={project.own_spool_m}
              // Изменение
              onChange={(m) => {
                // В проект
                setProject({ ...project, own_spool_m: m });
                // Сохранить
                schedule({ own_spool_m: m });
              }}
            />
          </Section>

          {/* Секция «Распечатать и поделиться» */}
          <Section title="Распечатать и поделиться">
            {/* Панель */}
            <SharePanel
              // id
              projectId={project.id}
              // Название
              name={name}
              // Последовательность
              sequence={project.sequence}
              // Линии
              lines={lines}
              // Диаметр
              diameterCm={diameter}
              // Леска (всех цветов)
              threadM={allRawM}
              // Сохранить перед скачиванием
              beforeDownload={flush}
              // Нити цветного портрета
              threads={drawn}
              // Цвет доски
              boardColor={multi ? boardColor(project) : undefined}
            />
          </Section>

          {/* Секция «Фото» */}
          <Section title="Фото">
            {/* Ряд */}
            <div className="photo-row">
              {/* Отключаем правило линтера */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {/* Миниатюра подготовленного фото */}
              <img className="photo-thumb" src={api.sourceUrl(project.id)} alt="Фото после обработки" width={72} height={72} />
              {/* Оригинал есть — можно править */}
              {project.image_id ? (
                // Ссылка
                <Link href={routes.photo(project.id)} className="btn secondary small" data-testid="edit-photo">
                  {/* Значок */}
                  <Icon name="image" size={18} />
                  {/* Надпись */}
                  Изменить фото
                </Link>
              // Иначе
              ) : (
                // Пояснение
                <span className="muted">Исходное фото не сохранилось</span>
              )}
            </div>
          </Section>

          {/* Ошибка */}
          {error && (
            // Абзац
            <p className="form-error" role="alert">
              {/* Текст */}
              {error}
            </p>
          )}

          {/* Удалить портрет */}
          <button type="button" className="btn danger-ghost small" onClick={remove}>
            {/* Значок */}
            <Icon name="trash" size={16} />
            {/* Надпись */}
            Удалить портрет
          </button>
        </div>
      </div>
    </div>
  );
}
