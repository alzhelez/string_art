// Компоненты работают в браузере
"use client";

// Хуки React
import { useRef, useState } from "react";
// Типы библиотек видео и музыки
import type { MusicLibrary, VideoLibrary } from "@/hooks/useMedia";
// Разрешения iframe, «нужен ли iframe», тип элемента
import { FRAME_ALLOW, isFramed, type MediaItem } from "@/lib/media";
// Переключатель
import { Switch } from "./ui/Controls";
// Иконки
import { Icon } from "./ui/Icon";

// Известные плееры (YouTube, RuTube, VK, Яндекс Музыка) — как на их сайтах, без ограничений:
// часть из них отказывается работать в «песочнице». Код с незнакомого сайта — в песочнице.
// Ограничения «песочницы» для незнакомых сайтов: скрипты и всплывающие окна можно, остальное — нет
const SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox allow-forms";
// Песочница только для кода с незнакомого сайта
const sandboxFor = (item: MediaItem) => (item.kind === "embed" ? SANDBOX : undefined);

/** Плеер текущего ролика — на сцене экрана плетения. */
// Плеер на сцене
export function MediaStage({ lib }: { lib: VideoLibrary }) {
  // Текущий элемент
  const item = lib.current;
  // Ничего не выбрано — плеера нет
  if (!item) return null;
  // Разметка
  return (
    // Экран плеера; класс — видео или аудио
    <div className={`media-screen ${item.video ? "is-video" : "is-audio"}`} data-testid="media-screen">
      {/* Встроенный плеер, видео или аудио */}
      {isFramed(item) ? (
        // Встроенный плеер (iframe)
        <iframe
          // Ссылка для команд play/pause
          ref={lib.frameRef}
          // key — при смене ролика iframe создаётся заново
          key={item.id}
          // Адрес плеера
          src={item.src}
          // Название (для экранного диктора)
          title={item.title}
          // Разрешения: звук, полный экран и т. д.
          allow={FRAME_ALLOW}
          // Песочница (только для незнакомых сайтов)
          sandbox={sandboxFor(item)}
          // Разрешить полный экран
          allowFullScreen
          // Какой адрес страницы сообщать плееру (YouTube без этого может не показать ролик)
          referrerPolicy="strict-origin-when-cross-origin"
          // Высота для аудио-виджета
          style={!item.video && item.height ? { height: item.height } : undefined}
        />
      // Иначе видеофайл
      ) : item.video ? (
        // Видеоплеер
        <video
          // Ссылка на элемент для паузы вместе с плетением
          ref={(el) => {
            // Запоминаем элемент
            lib.mediaRef.current = el;
          }}
          // Новый элемент на каждый ролик
          key={item.id}
          // Адрес файла
          src={item.src}
          // Стандартные кнопки управления
          controls
          // На iPhone — внутри страницы, а не на весь экран
          playsInline
          // Закончился — следующий в плейлисте
          onEnded={lib.next}
          // Метка для тестов
          data-testid="media-element"
        />
      // Иначе аудиофайл
      ) : (
        // Блок аудио
        <div className="media-audio">
          {/* Значок */}
          <Icon name="music" size={28} />
          {/* Название и плеер */}
          <div>
            {/* Название */}
            <strong>{item.title}</strong>
            {/* Аудиоплеер */}
            <audio
              // Ссылка на элемент
              ref={(el) => {
                // Запоминаем
                lib.mediaRef.current = el;
              }}
              // Новый элемент на каждый трек
              key={item.id}
              // Адрес
              src={item.src}
              // Кнопки управления
              controls
              // Следующий по окончании
              onEnded={lib.next}
              // Метка для тестов
              data-testid="media-element"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Поле «ссылка или код встраивания» + кнопка файлов. */
// Поле добавления медиа
function AddMedia({
  // id поля
  id,
  // Подсказка в поле
  placeholder,
  // Какие файлы можно выбрать
  accept,
  // Обработчик текста
  onInput,
  // Обработчик файлов
  onFiles,
  // Метка для тестов
  testId,
// Типы свойств
}: {
  // id
  id: string;
  // Подсказка
  placeholder: string;
  // Типы файлов
  accept: string;
  // Текст → результат
  onInput: (raw: string) => { ok: boolean; error?: string };
  // Файлы → результат
  onFiles: (files: FileList | null) => { ok: boolean; error?: string };
  // Метка
  testId: string;
// Тело компонента
}) {
  // Текст поля
  const [value, setValue] = useState("");
  // Ошибка
  const [error, setError] = useState("");
  // Ссылка на скрытое поле выбора файлов
  const fileInput = useRef<HTMLInputElement>(null);
  // Добавить введённое
  const submit = () => {
    // Обрабатываем
    const r = onInput(value);
    // Ошибка или пусто
    setError(r.ok ? "" : (r.error ?? ""));
    // Успех — очищаем поле
    if (r.ok) setValue("");
  };
  // Разметка
  return (
    // Блок добавления
    <div className="add-media">
      {/* Форма: поле и кнопка */}
      <form
        // Стиль
        className="add-media-row"
        // Без проверки браузером (проверяем сами)
        noValidate
        // Отправка
        onSubmit={(e) => {
          // Не перезагружать страницу
          e.preventDefault();
          // Добавить
          submit();
        }}
      >
        {/* Подпись поля (видна только экранному диктору) */}
        <label htmlFor={id} className="visually-hidden">
          {/* Текст подписи */}
          {placeholder}
        </label>
        {/* Многострочное поле — HTML-код бывает длинным */}
        <textarea
          // id
          id={id}
          // Одна строка по умолчанию
          rows={1}
          // Подсказка
          placeholder={placeholder}
          // Значение
          value={value}
          // Ввод
          onChange={(e) => setValue(e.target.value)}
          // Клавиши
          onKeyDown={(e) => {
            // Enter без Shift — добавить
            if (e.key === "Enter" && !e.shiftKey) {
              // Не переносить строку
              e.preventDefault();
              // Добавить
              submit();
            }
          }}
          // Вставка из буфера обмена
          onPaste={(e) => {
            // Вставили код или ссылку — сразу добавляем, без лишнего нажатия
            // Вставленный текст
            const text = e.clipboardData.getData("text");
            // Поле было пустым
            if (text && !value.trim()) {
              // Не вставлять в поле — сразу обрабатываем
              e.preventDefault();
              // Обработка
              const r = onInput(text);
              // Ошибка или пусто
              setError(r.ok ? "" : (r.error ?? ""));
              // Не подошло — показываем вставленное, чтобы можно было поправить
              if (!r.ok) setValue(text);
            }
          }}
        />
        {/* Кнопка «Добавить» (неактивна при пустом поле) */}
        <button type="submit" className="btn secondary small" disabled={!value.trim()}>
          {/* Надпись */}
          Добавить
        </button>
      </form>
      {/* Ряд с файлами */}
      <div className="add-media-row">
        {/* Кнопка открывает выбор файлов */}
        <button type="button" className="btn ghost small" onClick={() => fileInput.current?.click()}>
          {/* Значок */}
          <Icon name="film" size={18} />
          {/* Надпись */}
          Файлы с компьютера
        </button>
        {/* Скрытое поле выбора файлов */}
        <input
          // Ссылка
          ref={fileInput}
          // Тип — файл
          type="file"
          // Какие файлы показывать
          accept={accept}
          // Можно несколько
          multiple
          // Скрыто
          className="visually-hidden"
          // Метка для тестов
          data-testid={testId}
          // Выбрали файлы
          onChange={(e) => {
            // Обрабатываем
            const r = onFiles(e.target.files);
            // Ошибка или пусто
            setError(r.ok ? "" : (r.error ?? ""));
            // Сбрасываем выбор — тот же файл можно выбрать снова
            e.target.value = "";
          }}
        />
      </div>
      {/* Ошибка */}
      {error && (
        // Абзац
        <p className="form-error" role="alert">
          {/* Текст ошибки */}
          {error}
        </p>
      )}
    </div>
  );
}

// Список роликов или треков
function Playlist({
  // Подпись списка
  label,
  // Элементы
  items,
  // Текущий
  index,
  // Выбрать
  onPick,
  // Удалить
  onRemove,
// Типы свойств
}: {
  // Подпись
  label: string;
  // Элементы
  items: MediaItem[];
  // Номер
  index: number;
  // Выбрать
  onPick: (i: number) => void;
  // Удалить
  onRemove: (id: string) => void;
// Тело компонента
}) {
  // Пусто — ничего не рисуем
  if (!items.length) return null;
  // Разметка
  return (
    // Нумерованный список
    <ol className="playlist" aria-label={label}>
      {/* Пункт на каждый элемент */}
      {items.map((it, i) => (
        // Пункт; текущий выделен
        <li key={it.id} className={i === index ? "is-current" : undefined}>
          {/* Кнопка выбора; aria-current — текущий */}
          <button type="button" className="playlist-item" onClick={() => onPick(i)} aria-current={i === index}>
            {/* Значок видео или музыки */}
            <Icon name={it.video ? "film" : "music"} size={16} />
            {/* Название */}
            <span>{it.title}</span>
          </button>
          {/* Кнопка удаления */}
          <button type="button" className="icon-btn small" onClick={() => onRemove(it.id)} aria-label={`Убрать «${it.title}»`}>
            {/* Крестик */}
            <Icon name="close" size={16} />
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Вкладка «Видео»: что показывать на сцене. */
// Вкладка «Видео»
export function VideoPanel({ lib }: { lib: VideoLibrary }) {
  // Разметка
  return (
    // Панель
    <div className="media-panel" data-testid="media-panel">
      {/* Пояснение */}
      <p className="panel-lead">
        {/* Текст */}
        Фильм или сериал идёт на большом экране, шаг и схема — рядом. Ссылка YouTube, RuTube, VK Видео или код
        встраивания (в VK: «Поделиться» → «Экспортировать» → скопировать код).
      </p>
      {/* Поле добавления видео */}
      <AddMedia
        // id
        id="video-input"
        // Подсказка
        placeholder="Ссылка или код <iframe …>"
        // Видео и аудио файлы
        accept="video/*,audio/*,.mkv"
        // Текст
        onInput={lib.addInput}
        // Файлы
        onFiles={lib.addFiles}
        // Метка для тестов
        testId="media-file-input"
      />
      {/* Плейлист */}
      <Playlist label="Плейлист" items={lib.items} index={lib.index} onPick={lib.setIndex} onRemove={lib.remove} />
      {/* Переключатель паузы вместе с плетением */}
      <Switch
        // Подпись
        label="Пауза вместе с плетением"
        // Состояние
        checked={lib.sync}
        // Обработчик
        onChange={lib.setSync}
        // Пояснение
        hint={
          // Плеер управляется?
          lib.syncSupported
            // Да
            ? "Нажали «Пауза» — фильм остановится, «Продолжить» — пойдёт дальше."
            // Нет
            : "Этот плеер (VK, встроенный сайт) не даёт управлять собой со страницы — ставьте его на паузу сами."
        }
      />
      {/* Есть файлы — предупреждение */}
      {lib.items.some((i) => i.kind === "file") && (
        // Пояснение про файлы
        <small className="muted">Файлы с компьютера после перезагрузки страницы нужно выбрать заново, ссылки сохраняются.</small>
      )}
    </div>
  );
}

// Высота музыкального плеера: компактный и развёрнутый
const MUSIC_HEIGHTS = { compact: 180, full: 450 } as const;

/**
 * Музыка — отдельная графа: свой плеер (Яндекс Музыка, радио, mp3) под рукой у шага,
 * играет вместе с фильмом или вместо него. Плеер не пропадает при переключении вкладок.
 */
// Музыкальная панель
export function MusicDock({ lib }: { lib: MusicLibrary }) {
  // Показана форма добавления
  const [editing, setEditing] = useState(false);
  // Размер плеера
  const [size, setSize] = useState<keyof typeof MUSIC_HEIGHTS>("compact");
  // Текущий трек
  const item = lib.current;
  // Форма видна, если её открыли или музыки ещё нет
  const showForm = editing || !item;
  // Разметка
  return (
    // Секция «Музыка»
    <section className="music-dock" aria-label="Музыка" data-testid="music-dock">
      {/* Шапка */}
      <header className="music-head">
        {/* Значок */}
        <Icon name="music" size={18} />
        {/* Заголовок */}
        <h2>
          {/* Слово «Музыка» */}
          Музыка
          {/* Название текущего */}
          {item && <small className="music-now">{item.title}</small>}
        </h2>
        {/* Кнопки (если есть музыка) */}
        {item && (
          // Блок кнопок
          <div className="music-tools">
            {/* Развернуть/свернуть */}
            <button
              // Тип
              type="button"
              // Стиль
              className="icon-btn small"
              // Описание для экранного диктора
              aria-label={size === "compact" ? "Развернуть плеер" : "Свернуть плеер"}
              // Подсказка
              title={size === "compact" ? "Развернуть" : "Свернуть"}
              // Переключить размер
              onClick={() => setSize(size === "compact" ? "full" : "compact")}
            >
              {/* Значок */}
              <Icon name={size === "compact" ? "expand" : "shrink"} size={16} />
            </button>
            {/* Показать/скрыть плейлисты */}
            <button
              // Тип
              type="button"
              // Стиль
              className="icon-btn small"
              // Раскрыта ли форма
              aria-expanded={editing}
              // Описание
              aria-label="Плейлисты"
              // Подсказка
              title="Плейлисты"
              // Переключить
              onClick={() => setEditing(!editing)}
            >
              {/* Значок */}
              <Icon name="chevron" size={16} />
            </button>
          </div>
        )}
      </header>
      {/* Плеер (если есть музыка) */}
      {item &&
        // Встроенный плеер или аудио
        (isFramed(item) ? (
          // iframe
          <iframe
            // Новый на каждый трек
            key={item.id}
            // Стиль
            className="music-frame"
            // Адрес
            src={item.src}
            // Название
            title={item.title}
            // Разрешения
            allow={FRAME_ALLOW}
            // Песочница
            sandbox={sandboxFor(item)}
            // Высота: развёрнутый — не меньше 450 px, компактный — 180 px
            style={{ height: size === "full" ? Math.max(item.height ?? 0, MUSIC_HEIGHTS.full) : MUSIC_HEIGHTS.compact }}
            // Метка для тестов
            data-testid="music-frame"
          />
        // Иначе
        ) : (
          // Аудиоплеер
          <audio key={item.id} className="music-audio" src={item.src} controls onEnded={lib.next} data-testid="music-element" />
        ))}
      {/* Форма добавления */}
      {showForm && (
        // Блок формы
        <div className="music-form">
          {/* Подсказка, если музыки нет */}
          {!item && (
            // Абзац
            <p className="panel-lead">
              {/* Текст */}
              Вставьте HTML-код из Яндекс Музыки («Поделиться» → «HTML-код»), ссылку на альбом, радио или mp3.
            </p>
          )}
          {/* Поле добавления музыки */}
          <AddMedia
            // id
            id="music-input"
            // Подсказка
            placeholder="Код Яндекс Музыки или ссылка"
            // Только аудиофайлы
            accept="audio/*"
            // Текст
            onInput={(raw) => {
              // Добавляем
              const r = lib.addInput(raw);
              // Успех — форму закрываем
              if (r.ok) setEditing(false);
              // Результат
              return r;
            }}
            // Файлы
            onFiles={lib.addFiles}
            // Метка для тестов
            testId="music-file-input"
          />
          {/* Плейлист */}
          <Playlist label="Музыка" items={lib.items} index={lib.index} onPick={lib.setIndex} onRemove={lib.remove} />
        </div>
      )}
    </section>
  );
}
