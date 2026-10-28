// Компоненты работают в браузере
"use client";

// Хуки React
import { useEffect, useRef } from "react";
// Типы из хука редактора
import type { AutoStage, BrushTool, MaskStatus } from "@/hooks/usePhotoEditor";
// Типы данных API
import type { AutoTone, Features, ImageInfo } from "@/lib/api";
// Числа по-русски
import { num } from "@/lib/format";
// Кадр, настройки по умолчанию, отрисовка, сдвиг, пределы, тип настроек
import { cropBox, DEFAULT_PREP, drawPrepared, pan, PREP_LIMITS, type Prep } from "@/lib/prep";
// Кольцо гвоздей вокруг кадра
import { NailRing } from "./NailRing";
// Ползунок и переключатель
import { Slider, Switch } from "./ui/Controls";
// Иконки
import { Icon } from "./ui/Icon";

// --- Окно кадра ---------------------------------------------------------------
// Что окно кадра знает о кисти
export interface BrushApi {
  // Инструмент
  tool: BrushTool;
  /** Радиус кисти — доля стороны кадра. */
  size: number;
  // Начало мазка (координаты и радиус — в пикселях фото)
  begin: (x: number, y: number, r: number) => void;
  // Продолжение мазка
  move: (x: number, y: number) => void;
  // Конец мазка
  end: () => void;
}

// Свойства окна кадра
interface ViewportProps {
  // Информация о фото
  info: ImageInfo;
  // Оригинал (null — ещё грузится)
  image: HTMLImageElement | null;
  /** Фото так и не загрузилось (сервер недоступен). */
  imageError?: boolean;
  // Маска фона
  mask: HTMLCanvasElement | null;
  /** Меняется при каждой правке маски кистью — сигнал перерисовать. */
  maskVersion?: number;
  // Настройки кадра
  prep: Prep;
  // Изменение настроек
  onChange: (p: Prep) => void;
  // Кисть (если редактор её поддерживает)
  brush?: BrushApi;
}

/**
 * Фото внутри кольца гвоздей: тянуть — сдвиг, колесо или два пальца — масштаб.
 * В режиме кисти — стирать фон или возвращать части человека.
 * Показывает ровно то, что получит алгоритм (кадр в оттенках серого).
 */
// Окно кадра
export function PhotoViewport({ info, image, imageError = false, mask, maskVersion = 0, prep, onChange, brush }: ViewportProps) {
  // Холст
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Кружок-курсор кисти
  const cursorRef = useRef<HTMLDivElement>(null);
  // Пальцы/мышь, которые сейчас касаются (для жеста «щипок»)
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  // Начало щипка: расстояние между пальцами и масштаб в тот момент
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  // Идёт мазок кистью
  const stroking = useRef(false);
  // Свежие настройки для обработчиков событий
  const prepRef = useRef(prep);
  // Обновляем при каждом рендере
  prepRef.current = prep;
  // Режим кисти: выбран инструмент, есть маска и включено «Убрать фон»
  const painting = Boolean(brush && brush.tool !== "move" && mask && prep.remove_background);

  // Перерисовка кадра при любом изменении
  useEffect(() => {
    // Холст
    const canvas = canvasRef.current;
    // Нет холста или фото ещё не загрузилось
    if (!canvas || !image) return;
    // Рисуем в ближайшем кадре экрана
    const raf = requestAnimationFrame(() => drawPrepared(canvas, image, mask, prep, undefined, { showRemoved: painting }));
    // Отменить, если пришло новое изменение
    return () => cancelAnimationFrame(raf);
  // Зависимости
  }, [image, mask, maskVersion, prep, painting]);

  // Колесо мыши: preventDefault работает только у не-passive обработчика
  // Масштаб колесом мыши
  useEffect(() => {
    // Холст
    const canvas = canvasRef.current;
    // Нет — выход
    if (!canvas) return;
    // Обработчик колеса
    const onWheel = (e: WheelEvent) => {
      // Не прокручивать страницу
      e.preventDefault();
      // Текущие настройки
      const p = prepRef.current;
      // Плавный масштаб: вниз — меньше, вверх — больше
      onChange({ ...p, zoom: p.zoom * Math.exp(-e.deltaY * 0.0015) });
    };
    // passive: false — иначе preventDefault не сработает
    canvas.addEventListener("wheel", onWheel, { passive: false });
    // Отписка
    return () => canvas.removeEventListener("wheel", onWheel);
  // При смене обработчика
  }, [onChange]);

  // Ширина окна кадра на экране (для пересчёта сдвига)
  const viewport = () => canvasRef.current?.getBoundingClientRect().width || 1;

  /** Точка на экране → пиксель исходного фото. */
  // Перевод координат
  const toPhoto = (clientX: number, clientY: number) => {
    // Положение холста на экране
    const rect = canvasRef.current!.getBoundingClientRect();
    // Кадр на оригинале
    const [x0, y0, side] = cropBox(info.width, info.height, prepRef.current);
    // Точка в пикселях фото и радиус кисти
    return {
      // X
      x: x0 + ((clientX - rect.left) / rect.width) * side,
      // Y
      y: y0 + ((clientY - rect.top) / rect.height) * side,
      // Радиус = размер кисти × сторона кадра
      r: (brush?.size ?? 0) * side,
    };
  };

  // Двигать кружок-курсор кисти
  const moveCursor = (clientX: number, clientY: number) => {
    // Кружок
    const el = cursorRef.current;
    // Холст
    const canvas = canvasRef.current;
    // Нечего двигать
    if (!el || !canvas || !brush) return;
    // Положение холста
    const rect = canvas.getBoundingClientRect();
    // Положение обёртки (кружок позиционируется относительно неё)
    const parent = canvas.parentElement!.getBoundingClientRect();
    // Диаметр кружка на экране
    const d = brush.size * 2 * rect.width;
    // Размер кружка
    el.style.width = el.style.height = `${d}px`;
    // Центр кружка — под указателем
    el.style.transform = `translate(${clientX - parent.left - d / 2}px, ${clientY - parent.top - d / 2}px)`;
  };

  // Разметка
  return (
    // Обёртка; в режиме кисти — свой курсор
    <div className={`editor-view ${painting ? `is-painting is-${brush!.tool}` : ""}`}>
      {/* Кольцо гвоздей */}
      <NailRing className="drop-ring" />
      {/* Холст кадра */}
      <canvas
        // Ссылка
        ref={canvasRef}
        // Стиль
        className="editor-canvas"
        // Внутренняя ширина
        width={400}
        // Внутренняя высота
        height={400}
        // Можно выбрать клавишей Tab (управление стрелками)
        tabIndex={0}
        // Для экранного диктора — картинка
        role="img"
        // Описание зависит от режима
        aria-label={
          // Кисть?
          painting
            // Стереть?
            ? brush!.tool === "erase"
              // Описание «стереть»
              ? "Кадр портрета. Проведите по фото, чтобы сделать это место фоном."
              // Описание «вернуть»
              : "Кадр портрета. Проведите по фото, чтобы вернуть убранную часть."
            // Описание обычного режима
            : "Кадр портрета. Перетащите, чтобы сдвинуть; колесо мыши или клавиши плюс и минус — масштаб; стрелки — сдвиг."
        }
        // Метка для тестов
        data-testid="photo-viewport"
        // Текущий инструмент — для тестов и стилей
        data-tool={painting ? brush!.tool : "move"}
        // Нажали мышью или пальцем
        onPointerDown={(e) => {
          // Все дальнейшие движения этого указателя — нашему холсту, даже за его краем
          e.currentTarget.setPointerCapture(e.pointerId);
          // Запоминаем указатель
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          // Второй палец — начинается щипок
          if (pointers.current.size === 2) {
            // Если шёл мазок — завершаем
            if (stroking.current) {
              // Сбрасываем
              stroking.current = false;
              // Конец мазка
              brush?.end();
            }
            // Оба указателя
            const [a, b] = [...pointers.current.values()];
            // Запоминаем начальное расстояние и масштаб
            pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: prepRef.current.zoom };
          // Один указатель в режиме кисти — начало мазка
          } else if (painting) {
            // Точка на фото
            const pt = toPhoto(e.clientX, e.clientY);
            // Мазок начался
            stroking.current = true;
            // Начать мазок
            brush!.begin(pt.x, pt.y, pt.r);
          }
        }}
        // Движение
        onPointerMove={(e) => {
          // В режиме кисти двигаем кружок-курсор
          if (painting) moveCursor(e.clientX, e.clientY);
          // Предыдущее положение этого указателя
          const prev = pointers.current.get(e.pointerId);
          // Не нажат — только курсор
          if (!prev) return;
          // Новое положение
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          // Текущие настройки
          const p = prepRef.current;
          // Два пальца — щипок
          if (pointers.current.size === 2 && pinch.current) {
            // Оба указателя
            const [a, b] = [...pointers.current.values()];
            // Текущее расстояние
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            // Масштаб пропорционально расстоянию
            onChange({ ...p, zoom: pinch.current.zoom * (dist / pinch.current.dist) });
          // Мазок
          } else if (stroking.current) {
            // Точка на фото
            const pt = toPhoto(e.clientX, e.clientY);
            // Продолжить мазок
            brush!.move(pt.x, pt.y);
          // Один указатель без кисти — сдвиг кадра
          } else if (pointers.current.size === 1 && !painting) {
            // Сдвиг на разницу положений
            onChange(pan(info.width, info.height, p, e.clientX - prev.x, e.clientY - prev.y, viewport()));
          }
        }}
        // Отпустили
        onPointerUp={(e) => {
          // Забыть указатель
          pointers.current.delete(e.pointerId);
          // Меньше двух — щипок закончился
          if (pointers.current.size < 2) pinch.current = null;
          // Шёл мазок
          if (stroking.current) {
            // Завершаем
            stroking.current = false;
            // Конец мазка
            brush?.end();
          }
        }}
        // Отмена (например, система перехватила жест)
        onPointerCancel={(e) => {
          // Забыть указатель
          pointers.current.delete(e.pointerId);
          // Шёл мазок
          if (stroking.current) {
            // Завершаем
            stroking.current = false;
            // Конец мазка
            brush?.end();
          }
        }}
        // Клавиатура
        onKeyDown={(e) => {
          // Текущие настройки
          const p = prepRef.current;
          // Шаг сдвига — 1/20 окна
          const step = viewport() / 20;
          // Стрелки → сдвиг
          const moves: Record<string, [number, number]> = {
            // Влево
            ArrowLeft: [step, 0],
            // Вправо
            ArrowRight: [-step, 0],
            // Вверх
            ArrowUp: [0, step],
            // Вниз
            ArrowDown: [0, -step],
          };
          // Стрелка
          if (moves[e.key]) {
            // Не прокручивать страницу
            e.preventDefault();
            // Сдвиг
            onChange(pan(info.width, info.height, p, moves[e.key][0], moves[e.key][1], viewport()));
          // Плюс (или «=» — та же клавиша без Shift)
          } else if (e.key === "+" || e.key === "=") {
            // Увеличить на 10 %
            onChange({ ...p, zoom: p.zoom * 1.1 });
          // Минус
          } else if (e.key === "-") {
            // Уменьшить на 10 %
            onChange({ ...p, zoom: p.zoom / 1.1 });
          }
        }}
      />
      {/* Кружок-курсор кисти */}
      {painting && <div ref={cursorRef} className="brush-cursor" aria-hidden="true" />}
      {/* Пока фото нет — надпись (не мешает мыши) */}
      {!image && (
        // Надпись; ошибку диктор прочитает сразу
        <span className={`editor-loading ${imageError ? "is-error" : ""}`} role={imageError ? "alert" : "status"}>
          {/* Текст: ошибка или «загружаем» */}
          {imageError ? "Не удалось загрузить фото. Проверьте, что программа запущена, и обновите страницу." : "Загружаем фото…"}
        </span>
      )}
    </div>
  );
}

// --- Настройки ----------------------------------------------------------------
// Что панель настроек знает о кисти
export interface BrushControls {
  // Инструмент
  tool: BrushTool;
  // Сменить
  setTool: (t: BrushTool) => void;
  // Размер
  size: number;
  // Сменить размер
  setSize: (v: number) => void;
  // Можно ли отменить
  canUndo: boolean;
  // Отменить
  undo: () => void;
  // Маска поправлена
  edited: boolean;
  // Сбросить правки
  reset: () => void;
}

// Инструменты кисти
const TOOLS: { value: BrushTool; label: string; icon: "move" | "eraser" | "brush" }[] = [
  // Двигать кадр
  { value: "move", label: "Кадр", icon: "move" },
  // Стереть
  { value: "erase", label: "Стереть", icon: "eraser" },
  // Вернуть
  { value: "restore", label: "Вернуть", icon: "brush" },
];

/** Ручная правка фона: где нейросеть ошиблась, можно стереть лишнее или вернуть нужное. */
// Панель кисти
function BrushPanel({ b }: { b: BrushControls }) {
  // Разметка
  return (
    // Панель
    <div className="brush-panel" data-testid="brush-panel">
      {/* Заголовок */}
      <p className="brush-title">Поправить фон кистью</p>
      {/* Выбор инструмента */}
      <div className="segmented-wide" role="radiogroup" aria-label="Инструмент">
        {/* Кнопка на каждый */}
        {TOOLS.map((t) => (
          // Кнопка-переключатель
          <button
            // Ключ
            key={t.value}
            // Тип
            type="button"
            // Роль
            role="radio"
            // Выбран ли
            aria-checked={b.tool === t.value}
            // Выбрать
            onClick={() => b.setTool(t.value)}
          >
            {/* Значок */}
            <Icon name={t.icon} size={18} />
            {/* Подпись */}
            {t.label}
          </button>
        ))}
      </div>
      {/* Размер кисти (не для «двигать») */}
      {b.tool !== "move" && (
        // Ползунок
        <Slider
          // id
          id="brush-size"
          // Подпись
          label="Размер кисти"
          // Минимум — 1 % стороны кадра
          min={0.01}
          // Максимум — 12 %
          max={0.12}
          // Шаг
          step={0.005}
          // Значение
          value={b.size}
          // Показываем диаметр в процентах кадра
          display={`${num(Math.round(b.size * 200))} %`}
          // Изменение
          onChange={b.setSize}
        />
      )}
      {/* Подсказка по инструменту */}
      <small className="muted">
        {/* Текст подсказки */}
        {b.tool === "erase"
          // Стереть
          ? "Проведите по лишнему — оно станет фоном."
          // Иначе вернуть?
          : b.tool === "restore"
            // Вернуть
            ? "Проведите по бледно-розовому — эта часть вернётся."
            // Иначе — двигать
            : "Выберите «Стереть» или «Вернуть» и проведите по фото. Убранный фон в режиме кисти виден бледно-розовым."}
      </small>
      {/* Кнопки */}
      <div className="photo-actions">
        {/* Отменить мазок */}
        <button type="button" className="btn ghost small" onClick={b.undo} disabled={!b.canUndo}>
          {/* Значок */}
          <Icon name="undo" size={18} />
          {/* Надпись */}
          Отменить
        </button>
        {/* Вернуть автоматическую маску */}
        <button type="button" className="btn ghost small" onClick={b.reset} disabled={!b.edited && !b.canUndo}>
          {/* Надпись */}
          Вернуть как было
        </button>
      </div>
    </div>
  );
}

// Свойства панели настроек
interface ControlsProps {
  // Фото
  info: ImageInfo;
  // Возможности сервера
  features: Features | null;
  // Настройки
  prep: Prep;
  // Изменение
  onChange: (p: Prep) => void;
  // Состояние маски
  maskStatus: MaskStatus;
  // Ошибка маски
  maskError: string;
  // Подсказка о маске
  maskNote?: string;
}

// Проценты со знаком: «+10 %»
const percent = (v: number) => `${v > 0 ? "+" : ""}${num(Math.round(v * 100))} %`;

// Свойства автонастройки
export interface AutoProps {
  // Запустить
  run: () => void;
  // Идёт работа
  busy: boolean;
  // Этап
  stage: AutoStage;
  // Результат
  result: AutoTone | null;
  // Ошибка
  error: string;
}

// Что показывать на каждом этапе
const AUTO_STAGE_TEXT: Partial<Record<AutoStage, string>> = {
  // Кадр
  frame: "Ищем лицо и выбираем кадр…",
  // Фон
  background: "Убираем фон…",
  // Тон
  tone: "Подбираем яркость и контраст: пробуем 6 вариантов и сравниваем результат нитями с фото (15–20 секунд)…",
};

// Панель автонастройки
function AutoPanel({ auto }: { auto: AutoProps }) {
  // Результат
  const r = auto.result;
  // Разметка
  return (
    // Панель
    <div className="auto-panel" data-testid="auto-panel">
      {/* Кнопка запуска */}
      <button type="button" className="btn tonal wide" onClick={auto.run} disabled={auto.busy}>
        {/* Значок */}
        <Icon name="wand" />
        {/* Надпись */}
        {auto.busy ? "Настраиваем…" : "Автонастройка"}
      </button>
      {/* Пояснение (экранный диктор озвучит изменения) */}
      <p className="auto-note" aria-live="polite">
        {/* Идёт работа — этап */}
        {auto.busy ? (
          // Текст этапа
          AUTO_STAGE_TEXT[auto.stage]
        // Иначе готово с результатом
        ) : auto.stage === "done" && r ? (
          // Результат
          <span data-testid="auto-result">
            {/* Сходство выросло? */}
            {r.score_after > r.score_before + 1e-4 ? (
              // Фрагмент
              <>
                {/* На сколько выросло */}
                Сходство с фото выросло на <strong>{gain(r)}</strong>.
              </>
            // Иначе
            ) : (
              // Уже было лучшим
              <>Фото и так подходит — сходство с фото уже лучшее.</>
            )}{" "}
            {/* Подобранные значения */}
            Яркость {percent(r.brightness)}, контраст {percent(r.contrast)}.
          </span>
        // Иначе ошибка
        ) : auto.stage === "error" ? (
          // Текст ошибки
          <span role="alert" className="text-danger">
            {/* Сообщение */}
            {auto.error}
          </span>
        // Иначе — описание
        ) : (
          // Что делает автонастройка
          "Сама выберет кадр по лицу, уберёт фон и подберёт яркость и контраст так, чтобы картина из нитей была максимально похожа на фото."
        )}
      </p>
    </div>
  );
}

// Рост сходства в процентах
const gain = (r: AutoTone) => `${num(((r.score_after - r.score_before) / Math.max(1e-6, r.score_before)) * 100, 1)} %`;

// Панель настроек фото
export function PhotoControls({
  // Фото
  info,
  // Возможности
  features,
  // Настройки
  prep,
  // Изменение
  onChange,
  // Состояние маски
  maskStatus,
  // Ошибка
  maskError,
  // Подсказка
  maskNote,
  // Автонастройка
  auto,
  // Кисть
  brush,
// Типы свойств
}: ControlsProps & { auto?: AutoProps; brush?: BrushControls }) {
  // Есть ли лицо
  const hasFace = info.faces.length > 0 && info.face_prep !== null;
  // «Выделить лицо» недоступно без поиска лиц или без лица
  const faceDisabled = !features?.face_detection || !hasFace;
  // «Убрать фон» недоступно без модуля или пока маска считается
  const bgDisabled = !features?.background_removal || maskStatus === "loading";

  // Разметка
  return (
    // Панель
    <div className="photo-controls" data-testid="photo-controls">
      {/* Автонастройка (если передана) */}
      {auto && <AutoPanel auto={auto} />}

      {/* Масштаб */}
      <Slider
        // id
        id="prep-zoom"
        // Подпись
        label="Масштаб"
        // Минимум
        min={PREP_LIMITS.zoom[0]}
        // Максимум
        max={PREP_LIMITS.zoom[1]}
        // Шаг
        step={0.01}
        // Значение
        value={prep.zoom}
        // «×2,25»
        display={`×${num(prep.zoom, 2)}`}
        // Изменение
        onChange={(v) => onChange({ ...prep, zoom: v })}
      />
      {/* Яркость */}
      <Slider
        // id
        id="prep-brightness"
        // Подпись
        label="Яркость"
        // Минимум
        min={PREP_LIMITS.brightness[0]}
        // Максимум
        max={PREP_LIMITS.brightness[1]}
        // Шаг
        step={0.01}
        // Значение
        value={prep.brightness}
        // «+10 %»
        display={percent(prep.brightness)}
        // Изменение
        onChange={(v) => onChange({ ...prep, brightness: v })}
      />
      {/* Контраст */}
      <Slider
        // id
        id="prep-contrast"
        // Подпись
        label="Контраст"
        // Минимум
        min={PREP_LIMITS.contrast[0]}
        // Максимум
        max={PREP_LIMITS.contrast[1]}
        // Шаг
        step={0.01}
        // Значение
        value={prep.contrast}
        // Показ
        display={percent(prep.contrast)}
        // Изменение
        onChange={(v) => onChange({ ...prep, contrast: v })}
      />

      {/* Переключатели */}
      <div className="switch-list">
        {/* «Выделить лицо» */}
        <Switch
          // Подпись
          label="Выделить лицо"
          // Состояние
          checked={prep.face_focus}
          // Недоступность
          disabled={faceDisabled}
          // Включили/выключили
          onChange={(on) =>
            // Новые настройки
            onChange(
              // Включили и кадр по лицу есть
              on && info.face_prep
                // Кадр по лицу и флаг
                ? { ...prep, ...pickFrame(info.face_prep), face_focus: true }
                // Иначе только снимаем флаг
                : { ...prep, face_focus: false },
            )
          }
          // Пояснение
          hint={
            // Нет поиска лиц?
            !features?.face_detection
              // Подсказка установить
              ? "Поиск лица не установлен на сервере (нужен пакет opencv-python-headless)."
              // Иначе лицо есть?
              : hasFace
                // Что произойдёт
                ? "Кадр встанет на лицо, а алгоритм проработает его детальнее."
                // Лица нет
                : "Лицо анфас на фото не найдено — выберите кадр вручную."
          }
        />
        {/* «Убрать фон» */}
        <Switch
          // Подпись
          label="Убрать фон"
          // Состояние
          checked={prep.remove_background}
          // Недоступность
          disabled={bgDisabled}
          // Изменение
          onChange={(on) => onChange({ ...prep, remove_background: on })}
          // Ошибки — для немедленного озвучивания
          hintRole={maskStatus === "error" ? "alert" : undefined}
          // Пояснение
          hint={
            // Нет связи с сервером?
            features === null
              // Подсказка
              ? "Нет связи с бэкендом — проверьте, что он запущен, и обновите страницу."
              // Иначе модуль не установлен?
              : !features.background_removal
                // Как установить
                ? "Не установлено на сервере. В папке backend выполните pip install -r requirements-bg.txt и перезапустите бэкенд."
                // Иначе маска считается?
                : maskStatus === "loading"
                  // Прогресс
                  ? maskNote || "Убираем фон…"
                  // Иначе ошибка?
                  : maskStatus === "error"
                    // Текст ошибки
                    ? maskError
                    // Иначе — что произойдёт
                    : "Фон станет белым — все линии уйдут на человека."
          }
        />
      </div>
      {/* Панель кисти — когда маска готова */}
      {brush && prep.remove_background && maskStatus === "ready" && <BrushPanel b={brush} />}

      {/* Кнопки сброса */}
      <div className="photo-actions">
        {/* «Кадр по центру» */}
        <button
          // Тип
          type="button"
          // Стиль
          className="btn ghost small"
          // Центр и без масштаба
          onClick={() => onChange({ ...prep, center_x: 0.5, center_y: 0.5, zoom: 1 })}
        >
          {/* Надпись */}
          Кадр по центру
        </button>
        {/* «Сбросить всё» */}
        <button type="button" className="btn ghost small" onClick={() => onChange({ ...DEFAULT_PREP })}>
          {/* Надпись */}
          Сбросить всё
        </button>
      </div>
    </div>
  );
}

// Только кадр из настроек по лицу
function pickFrame(p: Prep): Pick<Prep, "center_x" | "center_y" | "zoom"> {
  // Центр и масштаб
  return { center_x: p.center_x, center_y: p.center_y, zoom: p.zoom };
}
