"use client";

import { useRef, useState } from "react";
import type { MusicLibrary, VideoLibrary } from "@/hooks/useMedia";
import { FRAME_ALLOW, isFramed, type MediaItem } from "@/lib/media";
import { Switch } from "./ui/Controls";
import { Icon } from "./ui/Icon";

// Известные плееры (YouTube, RuTube, VK, Яндекс Музыка) — как на их сайтах, без ограничений:
// часть из них отказывается работать в «песочнице». Код с незнакомого сайта — в песочнице.
const SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox allow-forms";
const sandboxFor = (item: MediaItem) => (item.kind === "embed" ? SANDBOX : undefined);

/** Плеер текущего ролика — на сцене экрана плетения. */
export function MediaStage({ lib }: { lib: VideoLibrary }) {
  const item = lib.current;
  if (!item) return null;
  return (
    <div className={`media-screen ${item.video ? "is-video" : "is-audio"}`} data-testid="media-screen">
      {isFramed(item) ? (
        <iframe
          ref={lib.frameRef}
          key={item.id}
          src={item.src}
          title={item.title}
          allow={FRAME_ALLOW}
          sandbox={sandboxFor(item)}
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          style={!item.video && item.height ? { height: item.height } : undefined}
        />
      ) : item.video ? (
        <video
          ref={(el) => {
            lib.mediaRef.current = el;
          }}
          key={item.id}
          src={item.src}
          controls
          playsInline
          onEnded={lib.next}
          data-testid="media-element"
        />
      ) : (
        <div className="media-audio">
          <Icon name="music" size={28} />
          <div>
            <strong>{item.title}</strong>
            <audio
              ref={(el) => {
                lib.mediaRef.current = el;
              }}
              key={item.id}
              src={item.src}
              controls
              onEnded={lib.next}
              data-testid="media-element"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Поле «ссылка или код встраивания» + кнопка файлов. */
function AddMedia({
  id,
  placeholder,
  accept,
  onInput,
  onFiles,
  testId,
}: {
  id: string;
  placeholder: string;
  accept: string;
  onInput: (raw: string) => { ok: boolean; error?: string };
  onFiles: (files: FileList | null) => { ok: boolean; error?: string };
  testId: string;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const submit = () => {
    const r = onInput(value);
    setError(r.ok ? "" : (r.error ?? ""));
    if (r.ok) setValue("");
  };
  return (
    <div className="add-media">
      <form
        className="add-media-row"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor={id} className="visually-hidden">
          {placeholder}
        </label>
        <textarea
          id={id}
          rows={1}
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={(e) => {
            // Вставили код или ссылку — сразу добавляем, без лишнего нажатия
            const text = e.clipboardData.getData("text");
            if (text && !value.trim()) {
              e.preventDefault();
              const r = onInput(text);
              setError(r.ok ? "" : (r.error ?? ""));
              if (!r.ok) setValue(text);
            }
          }}
        />
        <button type="submit" className="btn secondary small" disabled={!value.trim()}>
          Добавить
        </button>
      </form>
      <div className="add-media-row">
        <button type="button" className="btn ghost small" onClick={() => fileInput.current?.click()}>
          <Icon name="film" size={18} />
          Файлы с компьютера
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={accept}
          multiple
          className="visually-hidden"
          data-testid={testId}
          onChange={(e) => {
            const r = onFiles(e.target.files);
            setError(r.ok ? "" : (r.error ?? ""));
            e.target.value = "";
          }}
        />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Playlist({
  label,
  items,
  index,
  onPick,
  onRemove,
}: {
  label: string;
  items: MediaItem[];
  index: number;
  onPick: (i: number) => void;
  onRemove: (id: string) => void;
}) {
  if (!items.length) return null;
  return (
    <ol className="playlist" aria-label={label}>
      {items.map((it, i) => (
        <li key={it.id} className={i === index ? "is-current" : undefined}>
          <button type="button" className="playlist-item" onClick={() => onPick(i)} aria-current={i === index}>
            <Icon name={it.video ? "film" : "music"} size={16} />
            <span>{it.title}</span>
          </button>
          <button type="button" className="icon-btn small" onClick={() => onRemove(it.id)} aria-label={`Убрать «${it.title}»`}>
            <Icon name="close" size={16} />
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Вкладка «Видео»: что показывать на сцене. */
export function VideoPanel({ lib }: { lib: VideoLibrary }) {
  return (
    <div className="media-panel" data-testid="media-panel">
      <p className="panel-lead">
        Фильм или сериал идёт на большом экране, шаг и схема — рядом. Ссылка YouTube, RuTube, VK Видео или код
        встраивания (в VK: «Поделиться» → «Экспортировать» → скопировать код).
      </p>
      <AddMedia
        id="video-input"
        placeholder="Ссылка или код <iframe …>"
        accept="video/*,audio/*,.mkv"
        onInput={lib.addInput}
        onFiles={lib.addFiles}
        testId="media-file-input"
      />
      <Playlist label="Плейлист" items={lib.items} index={lib.index} onPick={lib.setIndex} onRemove={lib.remove} />
      <Switch
        label="Пауза вместе с плетением"
        checked={lib.sync}
        onChange={lib.setSync}
        hint={
          lib.syncSupported
            ? "Нажали «Пауза» — фильм остановится, «Продолжить» — пойдёт дальше."
            : "Этот плеер (VK, встроенный сайт) не даёт управлять собой со страницы — ставьте его на паузу сами."
        }
      />
      {lib.items.some((i) => i.kind === "file") && (
        <small className="muted">Файлы с компьютера после перезагрузки страницы нужно выбрать заново, ссылки сохраняются.</small>
      )}
    </div>
  );
}

const MUSIC_HEIGHTS = { compact: 180, full: 450 } as const;

/**
 * Музыка — отдельная графа: свой плеер (Яндекс Музыка, радио, mp3) под рукой у шага,
 * играет вместе с фильмом или вместо него. Плеер не пропадает при переключении вкладок.
 */
export function MusicDock({ lib }: { lib: MusicLibrary }) {
  const [editing, setEditing] = useState(false);
  const [size, setSize] = useState<keyof typeof MUSIC_HEIGHTS>("compact");
  const item = lib.current;
  const showForm = editing || !item;
  return (
    <section className="music-dock" aria-label="Музыка" data-testid="music-dock">
      <header className="music-head">
        <Icon name="music" size={18} />
        <h2>
          Музыка
          {item && <small className="music-now">{item.title}</small>}
        </h2>
        {item && (
          <div className="music-tools">
            <button
              type="button"
              className="icon-btn small"
              aria-label={size === "compact" ? "Развернуть плеер" : "Свернуть плеер"}
              title={size === "compact" ? "Развернуть" : "Свернуть"}
              onClick={() => setSize(size === "compact" ? "full" : "compact")}
            >
              <Icon name={size === "compact" ? "expand" : "shrink"} size={16} />
            </button>
            <button
              type="button"
              className="icon-btn small"
              aria-expanded={editing}
              aria-label="Плейлисты"
              title="Плейлисты"
              onClick={() => setEditing(!editing)}
            >
              <Icon name="chevron" size={16} />
            </button>
          </div>
        )}
      </header>
      {item &&
        (isFramed(item) ? (
          <iframe
            key={item.id}
            className="music-frame"
            src={item.src}
            title={item.title}
            allow={FRAME_ALLOW}
            sandbox={sandboxFor(item)}
            style={{ height: size === "full" ? Math.max(item.height ?? 0, MUSIC_HEIGHTS.full) : MUSIC_HEIGHTS.compact }}
            data-testid="music-frame"
          />
        ) : (
          <audio key={item.id} className="music-audio" src={item.src} controls onEnded={lib.next} data-testid="music-element" />
        ))}
      {showForm && (
        <div className="music-form">
          {!item && (
            <p className="panel-lead">
              Вставьте HTML-код из Яндекс Музыки («Поделиться» → «HTML-код»), ссылку на альбом, радио или mp3.
            </p>
          )}
          <AddMedia
            id="music-input"
            placeholder="Код Яндекс Музыки или ссылка"
            accept="audio/*"
            onInput={(raw) => {
              const r = lib.addInput(raw);
              if (r.ok) setEditing(false);
              return r;
            }}
            onFiles={lib.addFiles}
            testId="music-file-input"
          />
          <Playlist label="Музыка" items={lib.items} index={lib.index} onPick={lib.setIndex} onRemove={lib.remove} />
        </div>
      )}
    </section>
  );
}
