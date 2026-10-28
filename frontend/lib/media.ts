// Видео и музыка во время плетения: файлы с компьютера, ссылки и коды встраивания
// (YouTube, RuTube, VK Видео, Яндекс Музыка и любой сайт, который даёт <iframe>).

// Откуда взялся элемент медиатеки
export type MediaKind = "file" | "youtube" | "rutube" | "vk" | "yandex-music" | "embed" | "url";

// Элемент медиатеки (ролик, плейлист, файл)
export interface MediaItem {
  // Уникальный id
  id: string;
  // Тип
  kind: MediaKind;
  // Название для списка
  title: string;
  /** Для file/url — адрес для <audio>/<video>; для остальных — адрес iframe. */
  src: string;
  // Видео (true) или только звук
  video: boolean;
  /** Высота встроенного плеера в пикселях (для музыки — из кода встраивания). */
  height?: number;
}

// Расширения аудиофайлов
const AUDIO_EXT = /\.(mp3|ogg|oga|wav|m4a|aac|flac|opus|weba)(\?|#|$)/i;
// Расширения видеофайлов
const VIDEO_EXT = /\.(mp4|webm|ogv|mov|m4v|mkv)(\?|#|$)/i;

// Счётчик для уникальности id внутри одной миллисекунды
let counter = 0;
// Новый id: время + счётчик в системе счисления 36 (короче)
const newId = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Встроенный плеер (iframe), а не <audio>/<video>. */
// Нужен ли iframe
export const isFramed = (item: MediaItem) => item.kind !== "file" && item.kind !== "url";

// Домен без www. и m.
const host = (u: URL) => u.hostname.replace(/^(www|m)\./, "");

// id ролика YouTube из любой формы ссылки
function youtubeId(u: URL): string | null {
  // Домен без music. (YouTube Music)
  const h = host(u).replace(/^music\./, "");
  // Короткая ссылка youtu.be/ID
  if (h === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
  // Обычный YouTube
  if (h === "youtube.com" || h === "youtube-nocookie.com") {
    // youtube.com/watch?v=ID
    if (u.pathname === "/watch") return u.searchParams.get("v");
    // /embed/ID, /shorts/ID, /live/ID, /v/ID
    const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([\w-]{6,})/);
    // Нашли
    if (m) return m[2];
  }
  // Не YouTube
  return null;
}

// id ролика RuTube
function rutubeId(u: URL): string | null {
  // Не RuTube
  if (!host(u).endsWith("rutube.ru")) return null;
  // /video/ID, /play/embed/ID, /shorts/ID (ID — 20+ шестнадцатеричных символов)
  const m = u.pathname.match(/^\/(?:video|play\/embed|shorts)\/([0-9a-f]{20,})/i);
  // id или null
  return m ? m[1] : null;
}

// Домены VK
const VK_HOSTS = ["vkvideo.ru", "vk.com", "vk.ru"];

/** VK Видео: адрес плеера video_ext.php (код «Экспортировать» или обычная ссылка на ролик). */
// Адрес плеера VK
function vkEmbed(u: URL): string | null {
  // Не VK
  if (!VK_HOSTS.includes(host(u))) return null;
  // Уже адрес плеера (из кода «Экспортировать»)
  if (u.pathname === "/video_ext.php") {
    // Владелец ролика
    const oid = u.searchParams.get("oid");
    // id ролика
    const id = u.searchParams.get("id");
    // Без них плеер не работает
    if (!oid || !id) return null;
    // Собираем чистый адрес плеера
    const out = new URL("https://vkvideo.ru/video_ext.php");
    // Владелец
    out.searchParams.set("oid", oid);
    // id
    out.searchParams.set("id", id);
    // hash — ключ доступа (нужен для некоторых роликов)
    const hash = u.searchParams.get("hash");
    // Если есть — сохраняем
    if (hash) out.searchParams.set("hash", hash);
    // Качество: как было, иначе 2 (720p)
    out.searchParams.set("hd", u.searchParams.get("hd") ?? "2");
    // Готовый адрес
    return out.toString();
  }
  // vkvideo.ru/video-229696756_456255681, vk.com/video?z=video-1_2%2Fpl…, vk.com/clip-1_2
  // Путь и параметр z одной строкой
  const raw = `${u.pathname}?${u.searchParams.get("z") ?? ""}`;
  // Ищем «video-владелец_id» или «clip-владелец_id»
  const m = raw.match(/(?:video|clip)(-?\d+)_(\d+)/);
  // Не нашли
  if (!m) return null;
  // Адрес плеера
  return `https://vkvideo.ru/video_ext.php?oid=${m[1]}&id=${m[2]}&hd=2`;
}

/** Яндекс Музыка: адрес виджета /iframe/… (из кода «Поделиться → HTML-код» или из ссылки). */
// Адрес виджета Яндекс Музыки
function yandexMusicEmbed(u: URL): string | null {
  // Не Яндекс Музыка (разные национальные домены)
  if (!/^music\.yandex\.(ru|com|by|kz|uz)$/.test(u.hostname)) return null;
  // Уже адрес виджета
  if (u.pathname.startsWith("/iframe/")) return `https://music.yandex.ru${u.pathname}`;
  // Ссылка на альбом или трек в альбоме
  const album = u.pathname.match(/^\/album\/(\d+)(?:\/track\/(\d+))?/);
  // Альбом/трек → виджет
  if (album) return `https://music.yandex.ru/iframe/album/${album[1]}${album[2] ? `/track/${album[2]}` : ""}`;
  // Плейлист пользователя
  const playlist = u.pathname.match(/^\/users\/([^/]+)\/playlists\/(\d+)/);
  // Плейлист → виджет
  if (playlist) return `https://music.yandex.ru/iframe/playlist/${playlist[1]}/${playlist[2]}`;
  // Не распознали
  return null;
}

// Элемент YouTube
function youtubeItem(id: string, list: string | null): MediaItem {
  // Параметры плеера: управление из JS, воспроизведение внутри страницы, без чужих рекомендаций
  const params = new URLSearchParams({ enablejsapi: "1", playsinline: "1", rel: "0" });
  // Плейлист, если был в ссылке
  if (list) params.set("list", list);
  // Элемент
  return {
    // id
    id: newId(),
    // Тип
    kind: "youtube",
    // Название
    title: `YouTube: ${id}`,
    // Плеер youtube-nocookie — без лишних cookie
    src: `https://www.youtube-nocookie.com/embed/${id}?${params}`,
    // Видео
    video: true,
  };
}

// Разобрать строку как адрес http/https
function parseUrl(raw: string): URL | null {
  // new URL бросает исключение на мусор
  try {
    // Разбираем
    const u = new URL(raw.trim());
    // Только http и https (javascript:, file: и т. п. — нельзя)
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
    // Не адрес
  } catch {
    // null
    return null;
  }
}

/** Ссылка на ролик, песню или радио. null — это не ссылка. */
// Ссылка → элемент медиатеки
export function parseMediaLink(raw: string): MediaItem | null {
  // Разбираем адрес
  const u = parseUrl(raw);
  // Не адрес
  if (!u) return null;

  // YouTube?
  const yt = youtubeId(u);
  // Проверяем формат id
  if (yt && /^[\w-]{6,}$/.test(yt)) return youtubeItem(yt, u.searchParams.get("list"));
  // RuTube?
  const rt = rutubeId(u);
  // Да
  if (rt) {
    // Элемент RuTube
    return { id: newId(), kind: "rutube", title: `RuTube: ${rt.slice(0, 8)}…`, src: `https://rutube.ru/play/embed/${rt}`, video: true };
  }
  // VK?
  const vk = vkEmbed(u);
  // Да
  if (vk) return { id: newId(), kind: "vk", title: "VK Видео", src: vk, video: true };
  // Яндекс Музыка?
  const ym = yandexMusicEmbed(u);
  // Да — виджет высотой 450 px
  if (ym) return { id: newId(), kind: "yandex-music", title: "Яндекс Музыка", src: ym, video: false, height: 450 };

  // Иначе — прямая ссылка на файл или поток; имя — последний кусок пути
  const name = decodeURIComponent(u.pathname.split("/").pop() || u.hostname);
  // Элемент «ссылка»
  return {
    // id
    id: newId(),
    // Тип
    kind: "url",
    // Название — имя файла или домен
    title: name || u.hostname,
    // Адрес
    src: u.toString(),
    // Неизвестное расширение (часто — поток интернет-радио) играем как аудио.
    video: VIDEO_EXT.test(u.pathname) && !AUDIO_EXT.test(u.pathname),
  };
}

/**
 * Код встраивания <iframe …> (VK «Экспортировать», Яндекс Музыка «HTML-код», YouTube «Встроить»).
 * Из кода берётся только адрес плеера — сам HTML на страницу не вставляется.
 */
// Код встраивания → элемент
export function parseEmbedCode(code: string): MediaItem | null {
  // Нет тега iframe — это не код встраивания
  if (!/<iframe[\s>]/i.test(code)) return null;
  // Разбираем HTML безопасно (DOMParser не выполняет скрипты)
  const doc = new DOMParser().parseFromString(code, "text/html");
  // Первый iframe
  const frame = doc.querySelector("iframe");
  // Его адрес
  const u = parseUrl(frame?.getAttribute("src") ?? "");
  // Нет iframe/адреса или адрес не https — отказываемся
  if (!frame || !u || u.protocol !== "https:") return null;

  // Знакомый сервис?
  const fromLink = parseMediaLink(u.toString());
  // Да
  if (fromLink && fromLink.kind !== "url") {
    // Название из текста внутри кода: «Слушайте <a>Мне нравится</a> — <a>Автор</a> на Яндекс Музыке»
    // Содержимое <iframe> браузер разбирает как текст — разбираем его ещё раз как HTML
    const inner = new DOMParser().parseFromString(frame.textContent ?? "", "text/html");
    // Тексты ссылок
    const links = [...inner.querySelectorAll("a")].map((a) => a.textContent?.trim()).filter(Boolean);
    // Есть — делаем из них название
    if (links.length) fromLink.title = links.join(" — ");
    // Высота плеера из атрибута height или из style
    const h = Number(frame.getAttribute("height") || (frame.getAttribute("style") ?? "").match(/height:\s*(\d+)px/)?.[1]);
    // Для музыки берём высоту из кода (в пределах 100…600)
    if (fromLink.kind === "yandex-music" && h > 0) fromLink.height = Math.min(600, Math.max(100, h));
    // Готово
    return fromLink;
  }
  // Любой другой сайт с кодом встраивания
  // Ширина из кода
  const w = Number(frame.getAttribute("width"));
  // Высота из кода
  const h = Number(frame.getAttribute("height"));
  // Элемент «встраивание»
  return {
    // id
    id: newId(),
    // Тип
    kind: "embed",
    // Название — title iframe или домен
    title: frame.getAttribute("title") || host(u),
    // Адрес
    src: u.toString(),
    // Низкий (< 260 px) или вытянутый вверх плеер — это музыка, а не видео
    video: !(h > 0 && h < 260) && !(w > 0 && h > 0 && h > w),
    // Для низкого плеера сохраняем высоту
    height: h > 0 && h < 260 ? h : undefined,
  };
}

/** Ссылка или код встраивания — что вставил человек. */
// Универсальный разбор вставленного текста
export function parseMediaInput(raw: string): MediaItem | null {
  // Сначала как код встраивания, потом как ссылку
  return parseEmbedCode(raw) ?? parseMediaLink(raw);
}

// Файл с компьютера → элемент (makeUrl можно подменить в тестах)
export function fileItem(file: File, makeUrl: (f: File) => string = (f) => URL.createObjectURL(f)): MediaItem {
  // Элемент
  return {
    // id
    id: newId(),
    // Тип
    kind: "file",
    // Имя без расширения
    title: file.name.replace(/\.[^.]+$/, ""),
    // Временный адрес blob: для проигрывания
    src: makeUrl(file),
    // Видео по типу файла или расширению
    video: file.type.startsWith("video/") || VIDEO_EXT.test(file.name),
  };
}

/** Можно ли ставить плеер на паузу вместе с плетением. VK и Яндекс Музыка управлять собой не дают. */
// Поддерживает ли элемент синхронную паузу
export const canSync = (item: MediaItem) => item.kind === "file" || item.kind === "url" || item.kind === "youtube" || item.kind === "rutube";

/** Команды встроенным плеерам через postMessage (без загрузки их JS-библиотек). */
// Сообщение для плеера: играть/пауза/громкость
export function iframeCommand(item: MediaItem, action: "play" | "pause" | "volume", volume = 1): string | null {
  // YouTube
  if (item.kind === "youtube") {
    // Громкость 0..100
    if (action === "volume") return JSON.stringify({ event: "command", func: "setVolume", args: [Math.round(volume * 100)] });
    // Играть или пауза
    return JSON.stringify({ event: "command", func: action === "play" ? "playVideo" : "pauseVideo", args: "" });
  }
  // RuTube
  if (item.kind === "rutube") {
    // Громкость 0..1
    if (action === "volume") return JSON.stringify({ type: "player:setVolume", data: { volume } });
    // Играть или пауза
    return JSON.stringify({ type: action === "play" ? "player:play" : "player:pause", data: {} });
  }
  // Остальные плееры команд не принимают
  return null;
}

// Ссылки (но не файлы — их браузер не даст открыть снова без выбора) запоминаем между запусками.
// Ключ для видео
const LINKS_KEY = "stringart.media.links";
// Ключ для музыки
const MUSIC_KEY = "stringart.music";

// Прочитать список из localStorage
function load(key: string): MediaItem[] {
  // Хранилище может быть недоступно или испорчено
  try {
    // Текст
    const raw = localStorage.getItem(key);
    // JSON → массив
    const list = raw ? (JSON.parse(raw) as MediaItem[]) : [];
    // Только правильные элементы и без файлов
    return Array.isArray(list) ? list.filter((i) => i && i.kind !== "file" && typeof i.src === "string") : [];
    // Ошибка
  } catch {
    // Пустой список
    return [];
  }
}

// Сохранить список в localStorage
function save(key: string, items: MediaItem[]): void {
  // Хранилище может быть недоступно
  try {
    // Файлы не сохраняем — их адрес blob: живёт до закрытия страницы
    localStorage.setItem(key, JSON.stringify(items.filter((i) => i.kind !== "file")));
    // Не получилось
  } catch {
    /* не критично */
  }
}

// Загрузить сохранённые видео
export const loadSavedLinks = () => load(LINKS_KEY);
// Сохранить видео
export const saveLinks = (items: MediaItem[]) => save(LINKS_KEY, items);
// Загрузить музыку
export const loadMusic = () => load(MUSIC_KEY);
// Сохранить музыку
export const saveMusic = (items: MediaItem[]) => save(MUSIC_KEY, items);

/** Разрешения для встроенных плееров: звук, полный экран, «картинка в картинке». */
// Атрибут allow для iframe
export const FRAME_ALLOW = "autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write; screen-wake-lock";
