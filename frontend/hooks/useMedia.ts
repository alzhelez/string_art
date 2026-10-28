// Хук работает в браузере
"use client";

// Хуки React
import { useCallback, useEffect, useRef, useState } from "react";
// Функции медиатеки
import {
  // Поддерживает ли элемент паузу вместе с плетением
  canSync,
  // Файл → элемент
  fileItem,
  // Команда встроенному плееру
  iframeCommand,
  // Нужен ли iframe
  isFramed,
  // Загрузить сохранённую музыку
  loadMusic,
  // Загрузить сохранённые видео
  loadSavedLinks,
  // Разобрать ссылку или код встраивания
  parseMediaInput,
  // Сохранить видео
  saveLinks,
  // Сохранить музыку
  saveMusic,
  // Тип элемента
  type MediaItem,
} from "@/lib/media";

// Ключ настройки «пауза вместе с плетением»
const SYNC_KEY = "stringart.media.sync";
// Расширения медиафайлов (если браузер не определил тип файла)
const MEDIA_FILE = /\.(mp3|mp4|webm|ogg|wav|m4a|mkv|mov|flac|aac|opus)$/i;

// Результат добавления: успех или текст ошибки
export type AddResult = { ok: true } | { ok: false; error: string };

/** Список роликов или песен: добавление, выбор, удаление; ссылки помнятся между запусками. */
// Общая логика библиотеки (для видео и для музыки)
function useLibrary(load: () => MediaItem[], save: (items: MediaItem[]) => void) {
  // Элементы
  const [items, setItems] = useState<MediaItem[]>([]);
  // Номер текущего
  const [index, setIndex] = useState(0);
  // Текущий элемент (может не быть)
  const current = items[index] as MediaItem | undefined;

  // При открытии загружаем сохранённое (в эффекте — localStorage есть только в браузере)
  useEffect(() => {
    // Загрузка
    setItems(load());
    // Только при смене функции загрузки (то есть один раз)
  }, [load]);

  // Обновить список и сохранить
  const update = useCallback(
    // Новый список
    (next: MediaItem[]) => {
      // В состояние
      setItems(next);
      // В хранилище
      save(next);
    },
    // Зависимости
    [save],
  );

  // Добавить элементы в конец
  const add = (added: MediaItem[]) => {
    // Новый список
    update([...items, ...added]);
    // Если ничего не было выбрано — выбираем первое добавленное
    if (!current) setIndex(items.length); // ничего не играло — сразу показываем новое
  };

  // Добавить из текста (ссылка или код)
  const addInput = (raw: string): AddResult => {
    // Разбираем
    const item = parseMediaInput(raw);
    // Не распознали
    if (!item) {
      // Подсказка, что вставлять
      return { ok: false, error: "Не похоже на ссылку или код встраивания. Вставьте адрес целиком (https://…) или весь код <iframe …>." };
    }
    // Добавляем
    add([item]);
    // Успех
    return { ok: true };
  };

  // Добавить файлы с компьютера
  const addFiles = (files: FileList | File[] | null): AddResult => {
    // FileList → массив
    const list = Array.from(files ?? []);
    // Только аудио и видео
    const added = list
      // По типу или расширению
      .filter((f) => f.type.startsWith("audio/") || f.type.startsWith("video/") || MEDIA_FILE.test(f.name))
      // Файл → элемент
      .map((f) => fileItem(f));
    // Ни одного подходящего
    if (!added.length) return { ok: false, error: "Это не аудио и не видео. Подойдут mp3, mp4, webm, ogg, wav, m4a, mkv." };
    // Добавляем
    add(added);
    // Успех
    return { ok: true };
  };

  // Удалить элемент
  const remove = (id: string) => {
    // Где он в списке
    const i = items.findIndex((x) => x.id === id);
    // Сам элемент
    const removed = items[i];
    // Для файла освобождаем временный адрес blob:
    if (removed?.kind === "file") URL.revokeObjectURL(removed.src);
    // Список без него
    const next = items.filter((x) => x.id !== id);
    // Сохраняем
    update(next);
    // Поправить номер текущего: удалили выше текущего или текущий был последним
    if (i < index || index >= next.length) setIndex(Math.max(0, Math.min(index - (i < index ? 1 : 0), next.length - 1)));
  };

  // Следующий элемент (на последнем — остаёмся)
  const next = () => setIndex((i) => (i + 1 < items.length ? i + 1 : i));

  // Наружу
  return { items, index, setIndex, current, addInput, addFiles, remove, next };
}

/** Видео (и любая музыка файлом) на сцене + пауза вместе с плетением. */
// Библиотека видео
export function useVideoLibrary(weavePlaying: boolean) {
  // Общая логика с ключом видео
  const lib = useLibrary(loadSavedLinks, saveLinks);
  // Пауза вместе с плетением (по умолчанию включено)
  const [sync, setSyncState] = useState(true);
  // Ссылка на элемент <video>/<audio>
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  // Ссылка на iframe встроенного плеера
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  // Читаем сохранённую настройку
  useEffect(() => {
    // Хранилище может быть недоступно
    try {
      // "0" — выключено, всё остальное — включено
      setSyncState(localStorage.getItem(SYNC_KEY) !== "0");
      // Ошибка
    } catch {
      /* значение по умолчанию */
    }
    // Один раз
  }, []);

  // Переключить синхронизацию
  const setSync = (v: boolean) => {
    // В состояние
    setSyncState(v);
    // Сохранить
    try {
      // "1" или "0"
      localStorage.setItem(SYNC_KEY, v ? "1" : "0");
      // Не сохранилось
    } catch {
      /* не критично */
    }
  };

  // Текущий ролик
  const { current } = lib;
  // Команда текущему плееру
  const command = useCallback(
    // Играть или пауза
    (action: "play" | "pause") => {
      // Нечего
      if (!current) return;
      // Встроенный плеер
      if (isFramed(current)) {
        // Сообщение для него
        const msg = iframeCommand(current, action);
        // Отправляем в окно iframe (VK и Яндекс команд не принимают — msg = null)
        if (msg) frameRef.current?.contentWindow?.postMessage(msg, "*");
        // Обычный <video>/<audio>
      } else if (mediaRef.current) {
        // Играть (браузер может запретить автовоспроизведение — ошибку игнорируем)
        if (action === "play") void mediaRef.current.play().catch(() => undefined);
        // Пауза
        else mediaRef.current.pause();
      }
    },
    // Пересоздаётся при смене ролика
    [current],
  );

  // Плетение на паузе — фильм тоже; продолжили плести — продолжаем смотреть.
  // Срабатывает только на смену состояния плетения/переключателя, а не на выбор другого ролика.
  // Свежая версия command для эффекта ниже
  const commandRef = useRef(command);
  // Обновляем после каждого изменения
  useEffect(() => {
    // Записываем
    commandRef.current = command;
    // При смене command
  }, [command]);
  // Первый запуск эффекта пропускаем (не запускать фильм при открытии страницы)
  const firstSync = useRef(true);
  // Реакция на паузу/старт плетения
  useEffect(() => {
    // Первый раз
    if (firstSync.current) {
      // Больше не первый
      firstSync.current = false;
      // Ничего не делаем
      return;
    }
    // Если синхронизация включена — играть или пауза вместе с плетением
    if (sync) commandRef.current(weavePlaying ? "play" : "pause");
    // При смене состояния плетения или переключателя
  }, [weavePlaying, sync]);

  // Наружу: всё из библиотеки + синхронизация и ссылки на плееры
  return { ...lib, sync, setSync, mediaRef, frameRef, syncSupported: current ? canSync(current) : true };
}

/** Музыка — отдельно от видео: свой плеер (обычно Яндекс Музыка или радио), играет под фильм или вместо него. */
// Библиотека музыки
export function useMusicLibrary() {
  // Общая логика с ключом музыки
  return useLibrary(loadMusic, saveMusic);
}

// Тип библиотеки видео (выводится из функции)
export type VideoLibrary = ReturnType<typeof useVideoLibrary>;
// Тип библиотеки музыки
export type MusicLibrary = ReturnType<typeof useMusicLibrary>;
