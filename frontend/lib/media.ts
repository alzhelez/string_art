// Музыка и видео во время плетения: файлы с компьютера, YouTube, RuTube, прямые ссылки и интернет-радио.

export type MediaKind = "file" | "youtube" | "rutube" | "url";

export interface MediaItem {
  id: string;
  kind: MediaKind;
  title: string;
  /** Для file/url — адрес для <audio>/<video>; для youtube/rutube — адрес iframe. */
  src: string;
  video: boolean;
}

const AUDIO_EXT = /\.(mp3|ogg|oga|wav|m4a|aac|flac|opus|weba)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|webm|ogv|mov|m4v|mkv)(\?|#|$)/i;

let counter = 0;
const newId = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

function youtubeId(u: URL): string | null {
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, "");
  if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([\w-]{6,})/);
    if (m) return m[2];
  }
  return null;
}

function rutubeId(u: URL): string | null {
  if (!u.hostname.replace(/^www\./, "").endsWith("rutube.ru")) return null;
  const m = u.pathname.match(/^\/(?:video|play\/embed|shorts)\/([0-9a-f]{20,})/i);
  return m ? m[1] : null;
}

/** Разбирает ссылку, которую вставил человек. null — это не похоже на ссылку. */
export function parseMediaLink(raw: string): MediaItem | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;

  const yt = youtubeId(u);
  if (yt && /^[\w-]{6,}$/.test(yt)) {
    const list = u.searchParams.get("list");
    const params = new URLSearchParams({ enablejsapi: "1", playsinline: "1", rel: "0" });
    if (list) params.set("list", list);
    return {
      id: newId(),
      kind: "youtube",
      title: `YouTube: ${yt}`,
      src: `https://www.youtube-nocookie.com/embed/${yt}?${params}`,
      video: true,
    };
  }
  const rt = rutubeId(u);
  if (rt) {
    return { id: newId(), kind: "rutube", title: `RuTube: ${rt.slice(0, 8)}…`, src: `https://rutube.ru/play/embed/${rt}`, video: true };
  }
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

export function fileItem(file: File, makeUrl: (f: File) => string = (f) => URL.createObjectURL(f)): MediaItem {
  return {
    id: newId(),
    kind: "file",
    title: file.name.replace(/\.[^.]+$/, ""),
    src: makeUrl(file),
    video: file.type.startsWith("video/") || VIDEO_EXT.test(file.name),
  };
}

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

export function loadSavedLinks(): MediaItem[] {
  try {
    const raw = localStorage.getItem(LINKS_KEY);
    const list = raw ? (JSON.parse(raw) as MediaItem[]) : [];
    return list.filter((i) => i && i.kind !== "file" && typeof i.src === "string");
  } catch {
    return [];
  }
}

export function saveLinks(items: MediaItem[]): void {
  try {
    localStorage.setItem(LINKS_KEY, JSON.stringify(items.filter((i) => i.kind !== "file")));
  } catch {
    /* не критично */
  }
}
