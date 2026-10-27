// Видео и музыка во время плетения: файлы с компьютера, ссылки и коды встраивания
// (YouTube, RuTube, VK Видео, Яндекс Музыка и любой сайт, который даёт <iframe>).

export type MediaKind = "file" | "youtube" | "rutube" | "vk" | "yandex-music" | "embed" | "url";

export interface MediaItem {
  id: string;
  kind: MediaKind;
  title: string;
  /** Для file/url — адрес для <audio>/<video>; для остальных — адрес iframe. */
  src: string;
  video: boolean;
  /** Высота встроенного плеера в пикселях (для музыки — из кода встраивания). */
  height?: number;
}

const AUDIO_EXT = /\.(mp3|ogg|oga|wav|m4a|aac|flac|opus|weba)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|webm|ogv|mov|m4v|mkv)(\?|#|$)/i;

let counter = 0;
const newId = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Встроенный плеер (iframe), а не <audio>/<video>. */
export const isFramed = (item: MediaItem) => item.kind !== "file" && item.kind !== "url";

const host = (u: URL) => u.hostname.replace(/^(www|m)\./, "");

function youtubeId(u: URL): string | null {
  const h = host(u).replace(/^music\./, "");
  if (h === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
  if (h === "youtube.com" || h === "youtube-nocookie.com") {
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([\w-]{6,})/);
    if (m) return m[2];
  }
  return null;
}

function rutubeId(u: URL): string | null {
  if (!host(u).endsWith("rutube.ru")) return null;
  const m = u.pathname.match(/^\/(?:video|play\/embed|shorts)\/([0-9a-f]{20,})/i);
  return m ? m[1] : null;
}

const VK_HOSTS = ["vkvideo.ru", "vk.com", "vk.ru"];

/** VK Видео: адрес плеера video_ext.php (код «Экспортировать» или обычная ссылка на ролик). */
function vkEmbed(u: URL): string | null {
  if (!VK_HOSTS.includes(host(u))) return null;
  if (u.pathname === "/video_ext.php") {
    const oid = u.searchParams.get("oid");
    const id = u.searchParams.get("id");
    if (!oid || !id) return null;
    const out = new URL("https://vkvideo.ru/video_ext.php");
    out.searchParams.set("oid", oid);
    out.searchParams.set("id", id);
    const hash = u.searchParams.get("hash");
    if (hash) out.searchParams.set("hash", hash);
    out.searchParams.set("hd", u.searchParams.get("hd") ?? "2");
    return out.toString();
  }
  // vkvideo.ru/video-229696756_456255681, vk.com/video?z=video-1_2%2Fpl…, vk.com/clip-1_2
  const raw = `${u.pathname}?${u.searchParams.get("z") ?? ""}`;
  const m = raw.match(/(?:video|clip)(-?\d+)_(\d+)/);
  if (!m) return null;
  return `https://vkvideo.ru/video_ext.php?oid=${m[1]}&id=${m[2]}&hd=2`;
}

/** Яндекс Музыка: адрес виджета /iframe/… (из кода «Поделиться → HTML-код» или из ссылки). */
function yandexMusicEmbed(u: URL): string | null {
  if (!/^music\.yandex\.(ru|com|by|kz|uz)$/.test(u.hostname)) return null;
  if (u.pathname.startsWith("/iframe/")) return `https://music.yandex.ru${u.pathname}`;
  const album = u.pathname.match(/^\/album\/(\d+)(?:\/track\/(\d+))?/);
  if (album) return `https://music.yandex.ru/iframe/album/${album[1]}${album[2] ? `/track/${album[2]}` : ""}`;
  const playlist = u.pathname.match(/^\/users\/([^/]+)\/playlists\/(\d+)/);
  if (playlist) return `https://music.yandex.ru/iframe/playlist/${playlist[1]}/${playlist[2]}`;
  return null;
}

function youtubeItem(id: string, list: string | null): MediaItem {
  const params = new URLSearchParams({ enablejsapi: "1", playsinline: "1", rel: "0" });
  if (list) params.set("list", list);
  return {
    id: newId(),
    kind: "youtube",
    title: `YouTube: ${id}`,
    src: `https://www.youtube-nocookie.com/embed/${id}?${params}`,
    video: true,
  };
}

function parseUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/** Ссылка на ролик, песню или радио. null — это не ссылка. */
export function parseMediaLink(raw: string): MediaItem | null {
  const u = parseUrl(raw);
  if (!u) return null;

  const yt = youtubeId(u);
  if (yt && /^[\w-]{6,}$/.test(yt)) return youtubeItem(yt, u.searchParams.get("list"));
  const rt = rutubeId(u);
  if (rt) {
    return { id: newId(), kind: "rutube", title: `RuTube: ${rt.slice(0, 8)}…`, src: `https://rutube.ru/play/embed/${rt}`, video: true };
  }
  const vk = vkEmbed(u);
  if (vk) return { id: newId(), kind: "vk", title: "VK Видео", src: vk, video: true };
  const ym = yandexMusicEmbed(u);
  if (ym) return { id: newId(), kind: "yandex-music", title: "Яндекс Музыка", src: ym, video: false, height: 450 };

  const name = decodeURIComponent(u.pathname.split("/").pop() || u.hostname);
  return {
    id: newId(),
    kind: "url",
    title: name || u.hostname,
    src: u.toString(),
    // Неизвестное расширение (часто — поток интернет-радио) играем как аудио.
    video: VIDEO_EXT.test(u.pathname) && !AUDIO_EXT.test(u.pathname),
  };
}

/**
 * Код встраивания <iframe …> (VK «Экспортировать», Яндекс Музыка «HTML-код», YouTube «Встроить»).
 * Из кода берётся только адрес плеера — сам HTML на страницу не вставляется.
 */
export function parseEmbedCode(code: string): MediaItem | null {
  if (!/<iframe[\s>]/i.test(code)) return null;
  const doc = new DOMParser().parseFromString(code, "text/html");
  const frame = doc.querySelector("iframe");
  const u = parseUrl(frame?.getAttribute("src") ?? "");
  if (!frame || !u || u.protocol !== "https:") return null;

  const fromLink = parseMediaLink(u.toString());
  if (fromLink && fromLink.kind !== "url") {
    // Название из текста внутри кода: «Слушайте <a>Мне нравится</a> — <a>Автор</a> на Яндекс Музыке»
    // Содержимое <iframe> браузер разбирает как текст — разбираем его ещё раз как HTML
    const inner = new DOMParser().parseFromString(frame.textContent ?? "", "text/html");
    const links = [...inner.querySelectorAll("a")].map((a) => a.textContent?.trim()).filter(Boolean);
    if (links.length) fromLink.title = links.join(" — ");
    const h = Number(frame.getAttribute("height") || (frame.getAttribute("style") ?? "").match(/height:\s*(\d+)px/)?.[1]);
    if (fromLink.kind === "yandex-music" && h > 0) fromLink.height = Math.min(600, Math.max(100, h));
    return fromLink;
  }
  // Любой другой сайт с кодом встраивания
  const w = Number(frame.getAttribute("width"));
  const h = Number(frame.getAttribute("height"));
  return {
    id: newId(),
    kind: "embed",
    title: frame.getAttribute("title") || host(u),
    src: u.toString(),
    video: !(h > 0 && h < 260) && !(w > 0 && h > 0 && h > w),
    height: h > 0 && h < 260 ? h : undefined,
  };
}

/** Ссылка или код встраивания — что вставил человек. */
export function parseMediaInput(raw: string): MediaItem | null {
  return parseEmbedCode(raw) ?? parseMediaLink(raw);
}

export function fileItem(file: File, makeUrl: (f: File) => string = (f) => URL.createObjectURL(f)): MediaItem {
  return {
    id: newId(),
    kind: "file",
    title: file.name.replace(/\.[^.]+$/, ""),
    src: makeUrl(file),
    video: file.type.startsWith("video/") || VIDEO_EXT.test(file.name),
  };
}

/** Можно ли ставить плеер на паузу вместе с плетением. VK и Яндекс Музыка управлять собой не дают. */
export const canSync = (item: MediaItem) => item.kind === "file" || item.kind === "url" || item.kind === "youtube" || item.kind === "rutube";

/** Команды встроенным плеерам через postMessage (без загрузки их JS-библиотек). */
export function iframeCommand(item: MediaItem, action: "play" | "pause" | "volume", volume = 1): string | null {
  if (item.kind === "youtube") {
    if (action === "volume") return JSON.stringify({ event: "command", func: "setVolume", args: [Math.round(volume * 100)] });
    return JSON.stringify({ event: "command", func: action === "play" ? "playVideo" : "pauseVideo", args: "" });
  }
  if (item.kind === "rutube") {
    if (action === "volume") return JSON.stringify({ type: "player:setVolume", data: { volume } });
    return JSON.stringify({ type: action === "play" ? "player:play" : "player:pause", data: {} });
  }
  return null;
}

// Ссылки (но не файлы — их браузер не даст открыть снова без выбора) запоминаем между запусками.
const LINKS_KEY = "stringart.media.links";
const MUSIC_KEY = "stringart.music";

function load(key: string): MediaItem[] {
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? (JSON.parse(raw) as MediaItem[]) : [];
    return Array.isArray(list) ? list.filter((i) => i && i.kind !== "file" && typeof i.src === "string") : [];
  } catch {
    return [];
  }
}

function save(key: string, items: MediaItem[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items.filter((i) => i.kind !== "file")));
  } catch {
    /* не критично */
  }
}

export const loadSavedLinks = () => load(LINKS_KEY);
export const saveLinks = (items: MediaItem[]) => save(LINKS_KEY, items);
export const loadMusic = () => load(MUSIC_KEY);
export const saveMusic = (items: MediaItem[]) => save(MUSIC_KEY, items);

/** Разрешения для встроенных плееров: звук, полный экран, «картинка в картинке». */
export const FRAME_ALLOW = "autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write; screen-wake-lock";
