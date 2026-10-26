"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fileItem, iframeCommand, loadSavedLinks, parseMediaLink, saveLinks, type MediaItem } from "@/lib/media";
import { Switch } from "./ui/Controls";
import { Icon } from "./ui/Icon";

const SYNC_KEY = "stringart.media.sync";

/**
 * Фильм или музыка, пока руки заняты леской.
 * Файлы с компьютера, YouTube, RuTube, прямые ссылки на mp3/mp4 и интернет-радио.
 * По желанию ставится на паузу вместе с плетением и продолжает, когда плетение продолжается.
 */
export function MediaPanel({ weavePlaying }: { weavePlaying: boolean }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [index, setIndex] = useState(0);
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState("");
  const [sync, setSync] = useState(true);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const current = items[index] as MediaItem | undefined;

  useEffect(() => {
    setItems(loadSavedLinks());
    try {
      setSync(localStorage.getItem(SYNC_KEY) !== "0");
    } catch {
      /* значение по умолчанию */
    }
  }, []);

  const update = (next: MediaItem[]) => {
    setItems(next);
    saveLinks(next);
  };

  const command = useCallback(
    (action: "play" | "pause") => {
      if (!current) return;
      if (current.kind === "youtube" || current.kind === "rutube") {
        const msg = iframeCommand(current, action);
        if (msg) frameRef.current?.contentWindow?.postMessage(msg, "*");
      } else if (mediaRef.current) {
        if (action === "play") void mediaRef.current.play().catch(() => undefined);
        else mediaRef.current.pause();
      }
    },
    [current],
  );

  // Плетение на паузе — фильм тоже; продолжили плести — продолжаем смотреть.
  // Срабатывает только на смену состояния плетения/переключателя, а не на выбор другого трека.
  const commandRef = useRef(command);
  useEffect(() => {
    commandRef.current = command;
  }, [command]);
  const firstSync = useRef(true);
  useEffect(() => {
    if (firstSync.current) {
      firstSync.current = false;
      return;
    }
    if (sync) commandRef.current(weavePlaying ? "play" : "pause");
  }, [weavePlaying, sync]);

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const added = Array.from(files)
      .filter((f) => f.type.startsWith("audio/") || f.type.startsWith("video/") || /\.(mp3|mp4|webm|ogg|wav|m4a|mkv|mov|flac|aac)$/i.test(f.name))
      .map((f) => fileItem(f));
    if (!added.length) {
      setLinkError("Это не аудио и не видео. Подойдут mp3, mp4, webm, ogg, wav, m4a.");
      return;
    }
    setLinkError("");
    const next = [...items, ...added];
    update(next);
    if (!current) setIndex(items.length);
  };

  const addLink = () => {
    const item = parseMediaLink(link);
    if (!item) {
      setLinkError("Не похоже на ссылку. Вставьте адрес целиком, начиная с https://");
      return;
    }
    setLinkError("");
    setLink("");
    const next = [...items, item];
    update(next);
    if (!current) setIndex(items.length);
  };

  const remove = (id: string) => {
    const i = items.findIndex((x) => x.id === id);
    const removed = items[i];
    if (removed?.kind === "file") URL.revokeObjectURL(removed.src);
    const next = items.filter((x) => x.id !== id);
    update(next);
    if (i < index || index >= next.length) setIndex(Math.max(0, Math.min(index - (i < index ? 1 : 0), next.length - 1)));
  };

  const pip = async () => {
    const v = mediaRef.current;
    if (v instanceof HTMLVideoElement && "requestPictureInPicture" in v) {
      try {
        await v.requestPictureInPicture();
      } catch {
        /* браузер не дал — ничего страшного */
      }
    }
  };

  const onEnded = () => setIndex((i) => (i + 1 < items.length ? i + 1 : i));

  return (
    <div className="media" data-testid="media-panel">
      {current ? (
        <div className={`media-stage ${current.video ? "is-video" : "is-audio"}`}>
          {current.kind === "youtube" || current.kind === "rutube" ? (
            <iframe
              ref={frameRef}
              key={current.id}
              src={current.src}
              title={current.title}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
          ) : current.video ? (
            <video
              ref={(el) => {
                mediaRef.current = el;
              }}
              key={current.id}
              src={current.src}
              controls
              playsInline
              onEnded={onEnded}
              data-testid="media-element"
            />
          ) : (
            <div className="media-audio">
              <Icon name="music" size={28} />
              <div>
                <strong>{current.title}</strong>
                <audio
                  ref={(el) => {
                    mediaRef.current = el;
                  }}
                  key={current.id}
                  src={current.src}
                  controls
                  onEnded={onEnded}
                  data-testid="media-element"
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="media-empty">
          Добавьте фильм, сериал или музыку — с компьютера или по ссылке. Сигнал шага будет слышен поверх.
        </p>
      )}

      <div className="media-actions">
        <button type="button" className="btn secondary small" onClick={() => fileInput.current?.click()}>
          <Icon name="film" size={18} />
          Файлы с компьютера
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,video/*,.mkv"
          multiple
          className="visually-hidden"
          data-testid="media-file-input"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {current?.video && current.kind !== "youtube" && current.kind !== "rutube" && (
          <button type="button" className="btn ghost small" onClick={pip} title="Окно поверх других окон">
            <Icon name="pip" size={18} />
            Картинка в картинке
          </button>
        )}
      </div>

      <form
        className="media-link"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          addLink();
        }}
      >
        <label htmlFor="media-link" className="visually-hidden">
          Ссылка на видео, музыку или радио
        </label>
        <input
          id="media-link"
          type="url"
          inputMode="url"
          placeholder="Ссылка: YouTube, RuTube, mp3, радио"
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <button type="submit" className="btn secondary small" disabled={!link.trim()}>
          <Icon name="link" size={18} />
          Добавить
        </button>
      </form>
      {linkError && (
        <p className="form-error" role="alert">
          {linkError}
        </p>
      )}

      {items.length > 0 && (
        <ol className="playlist" aria-label="Плейлист">
          {items.map((it, i) => (
            <li key={it.id} className={i === index ? "is-current" : undefined}>
              <button type="button" className="playlist-item" onClick={() => setIndex(i)} aria-current={i === index}>
                <Icon name={it.video ? "film" : "music"} size={16} />
                <span>{it.title}</span>
              </button>
              <button type="button" className="icon-btn small" onClick={() => remove(it.id)} aria-label={`Убрать «${it.title}»`}>
                <Icon name="close" size={16} />
              </button>
            </li>
          ))}
        </ol>
      )}

      <Switch
        label="Пауза вместе с плетением"
        checked={sync}
        onChange={(v) => {
          setSync(v);
          try {
            localStorage.setItem(SYNC_KEY, v ? "1" : "0");
          } catch {
            /* не критично */
          }
        }}
        hint="Нажали «Пауза» — фильм остановится, «Продолжить» — пойдёт дальше."
      />
      {items.some((i) => i.kind === "file") && (
        <small className="muted">Файлы с компьютера после перезагрузки страницы нужно выбрать заново, ссылки сохраняются.</small>
      )}
    </div>
  );
}
