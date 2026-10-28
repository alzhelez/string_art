// Программа для Windows: не вышла ли новая версия (релиз desktop-latest на GitHub).

// Адрес API GitHub с данными релиза
export const RELEASE_API = "https://api.github.com/repos/alzhelez/string_art/releases/tags/desktop-latest";
// Страница релиза (если файла установщика нет)
export const RELEASE_PAGE = "https://github.com/alzhelez/string_art/releases/tag/desktop-latest";
// Ключ кэша последней проверки
const CACHE_KEY = "stringart.update";
// Ключ «эту версию отложили»
const DISMISS_KEY = "stringart.update.dismissed";
// Проверять не чаще раза в 6 часов
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

// Найденный релиз
export interface Release {
  // Номер версии
  version: string;
  // Ссылка на скачивание
  url: string;
}

/** «Нитеграф для Windows 1.4.12» → [1, 4, 12]. */
// Достать номер версии из текста
export function parseVersion(text: string): number[] | null {
  // Ищем три числа через точку
  const m = text.match(/(\d+)\.(\d+)\.(\d+)/);
  // Числа или null
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// Новее ли версия latest, чем current
export function isNewer(latest: string, current: string): boolean {
  // Разбираем обе
  const a = parseVersion(latest);
  // Текущую тоже
  const b = parseVersion(current);
  // Не разобрали — считаем, что обновления нет
  if (!a || !b) return false;
  // Сравниваем по частям: старшая, младшая, сборка
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  // Одинаковые
  return false;
}

// Поля ответа GitHub, которые нам нужны
interface GithubRelease {
  // Заголовок релиза
  name?: string;
  // Тег
  tag_name?: string;
  // Файлы релиза
  assets?: { name: string; browser_download_url: string }[];
}

// Ответ GitHub → наш Release
export function releaseFromGithub(data: GithubRelease): Release | null {
  // Версия из заголовка релиза
  const v = parseVersion(data.name ?? "");
  // Нет версии — релиз непонятный
  if (!v) return null;
  // Файл установщика
  const setup = data.assets?.find((a) => a.name.toLowerCase().endsWith("setup.exe"));
  // Версия и ссылка (на файл или на страницу)
  return { version: v.join("."), url: setup?.browser_download_url ?? RELEASE_PAGE };
}

/** Последний релиз; результат кэшируется на 6 часов, чтобы не дёргать GitHub каждый запуск. */
// Узнать последний релиз (now и fetcher можно подменить в тестах)
export async function latestRelease(now = Date.now(), fetcher: typeof fetch = fetch): Promise<Release | null> {
  // Кэш может быть испорчен
  try {
    // Читаем кэш
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as { at: number; release: Release | null } | null;
    // Свежий — отдаём без запроса
    if (cached && now - cached.at < CHECK_EVERY_MS) return cached.release;
    // Кэша нет
  } catch {
    /* нет кэша */
  }
  // Сеть может быть недоступна
  try {
    // Запрос к GitHub
    const res = await fetcher(RELEASE_API, { headers: { Accept: "application/vnd.github+json" } });
    // Ошибка (например, лимит запросов) — молча
    if (!res.ok) return null;
    // Разбираем ответ
    const release = releaseFromGithub(await res.json());
    // Сохраняем в кэш
    try {
      // Время проверки и результат
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: now, release }));
      // Не сохранилось — не страшно
    } catch {
      /* не критично */
    }
    // Релиз
    return release;
    // Нет интернета
  } catch {
    // Просто не показываем уведомление
    return null; // нет интернета — молча
  }
}

// Отложил ли человек эту версию
export function isDismissed(version: string): boolean {
  // Хранилище может быть недоступно
  try {
    // Совпадает ли с отложенной
    return localStorage.getItem(DISMISS_KEY) === version;
    // Ошибка — считаем, что не откладывали
  } catch {
    // Не откладывали
    return false;
  }
}

// Запомнить «Позже» для версии
export function dismiss(version: string): void {
  // Хранилище может быть недоступно
  try {
    // Записываем
    localStorage.setItem(DISMISS_KEY, version);
    // Не получилось
  } catch {
    /* не критично */
  }
}
