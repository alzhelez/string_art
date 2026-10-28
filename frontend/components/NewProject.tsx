// Компонент работает в браузере
"use client";

// Переход на другую страницу из кода
import { useRouter } from "next/navigation";
// Хуки React; useId — уникальный id для связи подписи и поля
import { useEffect, useId, useState } from "react";
// Хуки редактора фото и автонастройки
import { useAutoPrep, usePhotoEditor } from "@/hooks/usePhotoEditor";
// Адреса страниц
import { routes } from "@/lib/routes";
// API, тип ошибки, типы данных
import { api, ApiError, MONO_CHOICE, type Features, type ImageInfo, type Palette, type ThreadChoice } from "@/lib/api";
// Диаметр по умолчанию
import { DEFAULT_DIAMETER_CM } from "@/lib/constants";
// Уменьшение фото перед загрузкой
import { downscaleImage } from "@/lib/image";
// Настройки кадра по умолчанию
import { DEFAULT_PREP } from "@/lib/prep";
// Выбор диаметра
import { DiameterPicker } from "./DiameterPicker";
// Декоративное кольцо гвоздей
import { NailRing } from "./NailRing";
// Окно кадра и панель настроек фото
import { PhotoControls, PhotoViewport } from "./PhotoEditor";
// Выбор нитей: одна чёрная, чёрная + белая, цветные
import { previewBoard, threadChoiceValid, ThreadPicker } from "./ThreadPicker";
// Иконки
import { Icon } from "./ui/Icon";

// Какие файлы предлагать в окне выбора
const ACCEPT = "image/jpeg,image/png,image/webp,image/bmp,image/gif,image/tiff";

// Блок «Новый портрет» на главной
export function NewProject() {
  // Переходы между страницами
  const router = useRouter();
  // id поля выбора файла
  const inputId = useId();
  // Загруженное фото
  const [info, setInfo] = useState<ImageInfo | null>(null);
  // Возможности сервера
  const [features, setFeatures] = useState<Features | null>(null);
  // Каталог нитей и досок (null — сервер старый или ещё не ответил)
  const [palette, setPalette] = useState<Palette | null>(null);
  // Выбор нитей
  const [threads, setThreads] = useState<ThreadChoice>(MONO_CHOICE);
  // Имя файла без расширения (название по умолчанию)
  const [fileName, setFileName] = useState("");
  // Введённое название
  const [name, setName] = useState("");
  // Диаметр
  const [diameter, setDiameter] = useState(DEFAULT_DIAMETER_CM);
  // Перетаскивают файл над кругом
  const [dragging, setDragging] = useState(false);
  // Этап: выбор, загрузка, правка, расчёт
  const [stage, setStage] = useState<"pick" | "uploading" | "edit" | "creating">("pick");
  // Ошибка
  const [error, setError] = useState("");
  // Редактор фото
  const editor = usePhotoEditor(info);
  // Автонастройка
  const auto = useAutoPrep(info, features, editor, diameter);

  // При открытии
  useEffect(() => {
    // Узнаём, что умеет сервер
    api.features().then(setFeatures).catch(() => setFeatures(null));
    // Каталог нитей (без него — только одна чёрная нить)
    api.palette().then(setPalette).catch(() => setPalette(null));
  // Один раз
  }, []);

  // Выбрали файл
  const pick = async (f: File | undefined) => {
    // Сброс ошибки
    setError("");
    // Ничего не выбрали
    if (!f) return;
    // Не картинка
    if (!f.type.startsWith("image/")) {
      // Сообщаем
      setError("Это не изображение. Подойдут JPEG, PNG, WEBP.");
      // Выход
      return;
    }
    // Этап «загрузка»
    setStage("uploading");
    // Запоминаем имя без расширения
    setFileName(f.name.replace(/\.[^.]+$/, ""));
    // Ошибки ловим
    try {
      // Уменьшаем в браузере
      const blob = await downscaleImage(f);
      // Загружаем на сервер
      const uploaded = await api.uploadImage(blob, f.name);
      // Информация о фото
      setInfo(uploaded);
      // Сбрасываем настройки кадра
      editor.setPrep({ ...DEFAULT_PREP });
      // Этап «правка»
      setStage("edit");
    // Ошибка
    } catch (e) {
      // Текст
      setError(e instanceof ApiError ? e.message : "Не получилось загрузить фото. Попробуйте другое.");
      // Обратно к выбору
      setStage("pick");
    }
  };

  // «Сделать портрет»
  const submit = async () => {
    // Нет фото
    if (!info) return;
    // Этап «расчёт»
    setStage("creating");
    // Сброс ошибки
    setError("");
    // Ошибки ловим
    try {
      // Ждём отправку правок маски
      await editor.flushMask(); // правки фона кистью должны дойти до сервера
      // Создаём проект
      const project = await api.createFromImage({
        // Фото
        image_id: info.id,
        // Название или имя файла
        name: name || fileName,
        // Диаметр
        diameter_cm: diameter,
        // Настройки кадра
        prep: editor.prep,
        // Выбранные нити
        threads,
      });
      // Переходим в студию
      router.push(routes.project(project.id));
    // Ошибка
    } catch (e) {
      // Текст
      setError(e instanceof ApiError ? e.message : "Не получилось создать портрет. Попробуйте другое фото.");
      // Обратно к правке
      setStage("edit");
    }
  };

  // «Другое фото»
  const reset = () => {
    // Забыть фото
    setInfo(null);
    // Этап «выбор»
    setStage("pick");
    // Сброс ошибки
    setError("");
  };

  // Идёт загрузка или расчёт
  const busy = stage === "uploading" || stage === "creating";

  // Разметка
  return (
    // Секция
    <section className="new-project" aria-labelledby="new-title">
      {/* Есть фото — окно кадра, нет — зона загрузки */}
      {info && stage !== "uploading" ? (
        // Окно кадра
        <PhotoViewport
          // Информация о фото
          info={info}
          // Оригинал
          image={editor.image}
          // Ошибка загрузки оригинала
          imageError={editor.imageError}
          // Маска фона
          mask={editor.mask}
          // Счётчик правок маски
          maskVersion={editor.maskVersion}
          // Кисть с текущим инструментом и размером
          brush={{ ...editor.brush, tool: editor.tool, size: editor.brushSize }}
          // Настройки кадра
          prep={editor.prep}
          // Изменение настроек
          onChange={editor.setPrep}
          // Цветной портрет — превью в цвете на доске
          board={previewBoard(threads, palette)}
        />
      // Иначе
      ) : (
        // Зона загрузки (label — клик открывает выбор файла)
        <label
          // Связь с полем выбора файла
          htmlFor={inputId}
          // Стиль; при перетаскивании и загрузке — свои
          className={`drop ${dragging ? "is-drag" : ""} ${busy ? "is-busy" : ""}`}
          // Над зоной перетаскивают файл
          onDragOver={(e) => {
            // Разрешить «бросить» файл
            e.preventDefault();
            // Подсветить
            setDragging(true);
          }}
          // Ушли с зоны — убрать подсветку
          onDragLeave={() => setDragging(false)}
          // Бросили файл
          onDrop={(e) => {
            // Не открывать файл в браузере
            e.preventDefault();
            // Убрать подсветку
            setDragging(false);
            // Первый файл
            void pick(e.dataTransfer.files[0]);
          }}
        >
          {/* Кольцо гвоздей */}
          <NailRing className="drop-ring" />
          {/* Подпись по центру */}
          <span className="drop-text">
            {/* Значок */}
            <Icon name="image" size={28} />
            {/* Текст по этапу */}
            {stage === "uploading" ? "Загружаем фото…" : "Перетащите фото в круг"}
            {/* Пояснение */}
            {stage !== "uploading" && <small>или нажмите, чтобы выбрать файл</small>}
          </span>
          {/* Скрытое поле выбора файла */}
          <input
            // id для label
            id={inputId}
            // Тип — файл
            type="file"
            // Только картинки
            accept={ACCEPT}
            // Скрыто
            className="visually-hidden"
            // Метка для тестов
            data-testid="file-input"
            // Выбрали файл
            onChange={(e) => void pick(e.target.files?.[0])}
            // Во время загрузки — неактивно
            disabled={busy}
          />
        </label>
      )}

      {/* Правая колонка: название, диаметр, настройки */}
      <div className="inspector new-form">
        {/* Заголовок */}
        <h1 id="new-title">{info ? "Настройте фото" : "Портрет из нитей по вашему фото"}</h1>
        {/* Пояснение до загрузки */}
        {!info && (
          // Абзац
          <p className="lead">
            {/* Текст */}
            Загрузите снимок — приложение рассчитает, как натянуть чёрную леску на 240 гвоздей, чтобы получился
            портрет, и проведёт по каждому шагу.
          </p>
        )}

        {/* Поле названия */}
        <div className="field">
          {/* Подпись */}
          <label htmlFor="project-name">Название</label>
          {/* Поле */}
          <input
            // id для подписи
            id="project-name"
            // Текст
            type="text"
            // Не длиннее 100 символов
            maxLength={100}
            // Подсказка: имя файла или пример
            placeholder={fileName || "например, Бабушка"}
            // Значение
            value={name}
            // Ввод
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* Выбор диаметра */}
        <DiameterPicker value={diameter} onChange={setDiameter} id="new-diameter" />
        {/* Какими нитями плести */}
        <ThreadPicker palette={palette} value={threads} onChange={setThreads} />

        {/* Настройки фото (после загрузки) */}
        {info && (
          // Панель настроек
          <PhotoControls
            // Фото
            info={info}
            // Возможности сервера
            features={features}
            // Настройки кадра
            prep={editor.prep}
            // Изменение
            onChange={editor.setPrep}
            // Состояние маски
            maskStatus={editor.maskStatus}
            // Ошибка маски
            maskError={editor.maskError}
            // Подсказка о маске
            maskNote={editor.maskNote}
            // Кисть
            brush={{
              // Инструмент
              tool: editor.tool,
              // Сменить инструмент
              setTool: editor.setTool,
              // Размер
              size: editor.brushSize,
              // Сменить размер
              setSize: editor.setBrushSize,
              // Можно ли отменить
              canUndo: editor.canUndo,
              // Отменить
              undo: editor.undo,
              // Маска поправлена
              edited: editor.maskEdited,
              // Сбросить правки
              reset: () => void editor.resetMask(),
            }}
            // Автонастройка
            auto={auto}
          />
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
          {/* «Сделать портрет» */}
          <button
            // Тип
            type="button"
            // Главная кнопка
            className="btn primary"
            // Нажатие
            onClick={submit}
            // Неактивна без фото, во время работы, пока грузится маска или идёт автонастройка
            disabled={!info || busy || editor.maskStatus === "loading" || auto.busy || !threadChoiceValid(threads, palette)}
          >
            {/* Значок */}
            <Icon name="sparkle" size={18} />
            {/* Надпись по этапу */}
            {stage === "creating" ? "Считаем линии…" : "Сделать портрет"}
          </button>
          {/* «Другое фото» */}
          {info && !busy && (
            // Кнопка
            <button type="button" className="btn secondary" onClick={reset}>
              {/* Надпись */}
              Другое фото
            </button>
          )}
        </div>
        {/* Пояснение во время расчёта */}
        {stage === "creating" && (
          // Подсказка о времени расчёта
          <p className="muted">{threads.mode === "mono" ? "Обычно это занимает пару секунд." : "Считаем каждую нить отдельно — 10–20 секунд."}</p>
        )}
      </div>
    </section>
  );
}
