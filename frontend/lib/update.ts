// Программа для Windows: не вышла ли новая версия (релиз desktop-latest на GitHub).

export const RELEASE_API = "https://api.github.com/repos/alzhelez/string_art/releases/tags/desktop-latest";
export const RELEASE_PAGE = "https://github.com/alzhelez/string_art/releases/tag/desktop-latest";
const CACHE_KEY = "stringart.update";
const DISMISS_KEY = "stringart.update.dismissed";
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export interface Release {
  version: string;
  url: string;
}

/** «Нитеграф для Windows 1.4.12» → [1, 4, 12]. */
export function parseVersion(text: string): number[] | null {
  const m = text.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

interface GithubRelease {
  name?: string;
  tag_name?: string;
  assets?: { name: string; browser_download_url: string }[];
}

export function releaseFromGithub(data: GithubRelease): Release | null {
  const v = parseVersion(data.name ?? "");
  if (!v) return null;
  const setup = data.assets?.find((a) => a.name.toLowerCase().endsWith("setup.exe"));
  return { version: v.join("."), url: setup?.browser_download_url ?? RELEASE_PAGE };
}

/** Последний релиз; результат кэшируется на 6 часов, чтобы не дёргать GitHub каждый запуск. */
export async function latestRelease(now = Date.now(), fetcher: typeof fetch = fetch): Promise<Release | null> {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as { at: number; release: Release | null } | null;
    if (cached && now - cached.at < CHECK_EVERY_MS) return cached.release;
  } catch {
    /* нет кэша */
  }
  try {
    const res = await fetcher(RELEASE_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return null;
    const release = releaseFromGithub(await res.json());
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: now, release }));
    } catch {
      /* не критично */
    }
    return release;
  } catch {
    return null; // нет интернета — молча
  }
}

export function isDismissed(version: string): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === version;
  } catch {
    return false;
  }
}

export function dismiss(version: string): void {
  try {
    localStorage.setItem(DISMISS_KEY, version);
  } catch {
    /* не критично */
  }
}
