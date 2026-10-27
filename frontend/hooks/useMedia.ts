"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  canSync,
  fileItem,
  iframeCommand,
  isFramed,
  loadMusic,
  loadSavedLinks,
  parseMediaInput,
  saveLinks,
  saveMusic,
  type MediaItem,
} from "@/lib/media";

const SYNC_KEY = "stringart.media.sync";
const MEDIA_FILE = /\.(mp3|mp4|webm|ogg|wav|m4a|mkv|mov|flac|aac|opus)$/i;

export type AddResult = { ok: true } | { ok: false; error: string };

/** Список роликов или песен: добавление, выбор, удаление; ссылки помнятся между запусками. */
function useLibrary(load: () => MediaItem[], save: (items: MediaItem[]) => void) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [index, setIndex] = useState(0);
  const current = items[index] as MediaItem | undefined;

  useEffect(() => {
    setItems(load());
  }, [load]);

  const update = useCallback(
    (next: MediaItem[]) => {
      setItems(next);
      save(next);
    },
    [save],
  );

  const add = (added: MediaItem[]) => {
    update([...items, ...added]);
    if (!current) setIndex(items.length); // ничего не играло — сразу показываем новое
  };

  const addInput = (raw: string): AddResult => {
    const item = parseMediaInput(raw);
    if (!item) {
      return { ok: false, error: "Не похоже на ссылку или код встраивания. Вставьте адрес целиком (https://…) или весь код <iframe …>." };
    }
    add([item]);
    return { ok: true };
  };

  const addFiles = (files: FileList | File[] | null): AddResult => {
    const list = Array.from(files ?? []);
    const added = list
      .filter((f) => f.type.startsWith("audio/") || f.type.startsWith("video/") || MEDIA_FILE.test(f.name))
      .map((f) => fileItem(f));
    if (!added.length) return { ok: false, error: "Это не аудио и не видео. Подойдут mp3, mp4, webm, ogg, wav, m4a, mkv." };
    add(added);
    return { ok: true };
  };

  const remove = (id: string) => {
    const i = items.findIndex((x) => x.id === id);
    const removed = items[i];
    if (removed?.kind === "file") URL.revokeObjectURL(removed.src);
    const next = items.filter((x) => x.id !== id);
    update(next);
    if (i < index || index >= next.length) setIndex(Math.max(0, Math.min(index - (i < index ? 1 : 0), next.length - 1)));
  };

  const next = () => setIndex((i) => (i + 1 < items.length ? i + 1 : i));

  return { items, index, setIndex, current, addInput, addFiles, remove, next };
}

/** Видео (и любая музыка файлом) на сцене + пауза вместе с плетением. */
export function useVideoLibrary(weavePlaying: boolean) {
  const lib = useLibrary(loadSavedLinks, saveLinks);
  const [sync, setSyncState] = useState(true);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    try {
      setSyncState(localStorage.getItem(SYNC_KEY) !== "0");
    } catch {
      /* значение по умолчанию */
    }
  }, []);

  const setSync = (v: boolean) => {
    setSyncState(v);
    try {
      localStorage.setItem(SYNC_KEY, v ? "1" : "0");
    } catch {
      /* не критично */
    }
  };

  const { current } = lib;
  const command = useCallback(
    (action: "play" | "pause") => {
      if (!current) return;
      if (isFramed(current)) {
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
  // Срабатывает только на смену состояния плетения/переключателя, а не на выбор другого ролика.
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

  return { ...lib, sync, setSync, mediaRef, frameRef, syncSupported: current ? canSync(current) : true };
}

/** Музыка — отдельно от видео: свой плеер (обычно Яндекс Музыка или радио), играет под фильм или вместо него. */
export function useMusicLibrary() {
  return useLibrary(loadMusic, saveMusic);
}

export type VideoLibrary = ReturnType<typeof useVideoLibrary>;
export type MusicLibrary = ReturnType<typeof useMusicLibrary>;
