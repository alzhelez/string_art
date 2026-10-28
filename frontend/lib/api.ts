// Тип настроек кадра (только тип — в сборку не попадает)
import type { Prep } from "./prep";
// Тип сводки по леске
import type { ThreadStats } from "./thread";

// Прямоугольник лица в долях фото
export interface FaceBox {
  // Левый край
  x: number;
  // Верхний край
  y: number;
  // Ширина
  w: number;
  // Высота
  h: number;
}

// Загруженное в редактор фото
export interface ImageInfo {
  // id
  id: string;
  // Ширина, px
  width: number;
  // Высота, px
  height: number;
  // Найденные лица
  faces: FaceBox[];
  // Есть ли маска фона
  has_mask: boolean;
  // Готовый кадр по лицу
  face_prep: Prep | null;
}

// Кривая сходства
export interface Similarity {
  // Для какого диаметра
  diameter_cm: number;
  // Рекомендуемое число линий
  best_lines: number;
  // Сходство в лучшей точке
  best_score: number;
  // Точки кривой
  curve: { lines: number; score: number }[];
}

// Результат автонастройки
export interface AutoTone {
  // Яркость
  brightness: number;
  // Контраст
  contrast: number;
  // Сходство до
  score_before: number;
  // Сходство после
  score_after: number;
  // Лучшее число линий до
  lines_before: number;
  // Лучшее число линий после
  best_lines: number;
  // Сколько вариантов перебрано
  candidates: number;
}

// Что умеет сервер
export interface Features {
  // Поиск лица
  face_detection: boolean;
  // Удаление фона
  background_removal: boolean;
}

// Проект в списке
export interface ProjectSummary {
  // id
  id: string;
  // Название
  name: string;
  // Создан
  created_at: string;
  // Изменён
  updated_at: string;
  // Диаметр
  diameter_cm: number;
  // Число линий
  line_count: number;
  // Текущий шаг
  current_step: number;
  // Скорость
  speed_sec: number;
  // Исходное фото
  image_id: string | null;
  // Настройки кадра (могут быть неполными у старых проектов)
  prep: Partial<Prep>;
  /** Длина своей катушки, м (для плана смены катушек); null — стандартная из расчёта. */
  own_spool_m: number | null;
  // Журнал времени
  activity: Activity;
  // Сводка по леске
  stats: ThreadStats;
  // Режим: одна чёрная нить, чёрная + белая, цветные (у старых серверов поля может не быть)
  mode?: ThreadMode;
  // Цвет доски
  board?: Swatch;
  // Какую нить сейчас плетут
  current_layer?: number;
  // Нити по порядку плетения (у портрета из одной нити — одна чёрная)
  layers?: LayerSummary[];
}

// Режим нитей портрета
export type ThreadMode = "mono" | "bw" | "color";

// Цвет из каталога: нить или доска
export interface Swatch {
  // Ключ латиницей
  key: string;
  // Название по-русски
  name: string;
  // Цвет #rrggbb
  hex: string;
}

// Одна нить (слой) портрета
export interface LayerSummary extends Swatch {
  // Номер слоя по порядку плетения, с 0
  index: number;
  // Ключ цвета нити (то же, что key у Swatch)
  color: string;
  // Число линий слоя
  line_count: number;
  // Текущий шаг слоя
  current_step: number;
  // Леска этого цвета
  stats: ThreadStats;
}

// Слой с последовательностью гвоздей
export interface Layer extends LayerSummary {
  // Гвозди по порядку, первый — A1
  sequence: number[];
}

// Каталог нитей и досок для цветных портретов
export interface Palette {
  // Режимы
  modes: ThreadMode[];
  // Нити
  threads: Swatch[];
  // Цвета доски
  boards: Swatch[];
  // Доска по умолчанию для каждого режима
  default_board: Record<ThreadMode, string>;
  // Сколько цветов можно выбрать
  colors: { min: number; max: number; default: number };
  // Наименьшее число линий слоя
  layer_min_lines: number;
}

// Выбор нитей при создании портрета или правке фото
export interface ThreadChoice {
  // Режим
  mode: ThreadMode;
  // Цвета вручную (null — подобрать под фото)
  colors: string[] | null;
  // Сколько цветов подобрать
  color_count: number;
  // Цвет доски (null — по умолчанию для режима)
  board: string | null;
}

// Одна чёрная нить — выбор по умолчанию
export const MONO_CHOICE: ThreadChoice = { mode: "mono", colors: null, color_count: 3, board: null };

// Время за день
export interface ActivityDay {
  // Дата
  date: string;
  // Секунд
  sec: number;
  // Шагов
  steps: number;
}

// Журнал времени
export interface Activity {
  // Всего секунд
  total_sec: number;
  // Всего шагов
  total_steps: number;
  // По дням
  days: ActivityDay[];
}

// Версия программы
export interface AppInfo {
  // Номер версии («dev» у разработчика)
  version: string;
  // Программа для Windows
  desktop: boolean;
}

// Полный проект
export interface Project extends ProjectSummary {
  /** Гвозди по порядку; длина 5001, первый — A1. */
  sequence: number[];
  // Слои с последовательностями
  layers?: Layer[];
}

// Что можно менять запросом PATCH — часть полей проекта, каждое необязательно
export type ProjectPatch = Partial<
  // Выбранные поля
  Pick<Project, "name" | "diameter_cm" | "line_count" | "current_step" | "speed_sec" | "own_spool_m" | "current_layer">
// Номер слоя, к которому относятся line_count и current_step
> & { layer?: number };

// Поля нитей для тела запроса (без выбора — ничего)
function threadFields(t?: ThreadChoice): Partial<ThreadChoice> {
  // Нет выбора — пусто
  if (!t) return {};
  // Режим, цвета (null — подобрать), число цветов, доска
  return { mode: t.mode, colors: t.mode === "color" ? t.colors : null, color_count: t.color_count, board: t.board };
}

// Тело без поля threads (оно разворачивается в отдельные поля)
function withoutThreads<T extends { threads?: ThreadChoice }>(body: T): Omit<T, "threads"> {
  // Копия без threads
  const { threads: _unused, ...rest } = body;
  // Отдаём
  return rest;
}

// Ошибка API с HTTP-кодом и понятным текстом
export class ApiError extends Error {
  // Конструктор
  constructor(
    // public — сразу становится полем объекта
    public status: number,
    // Текст ошибки
    message: string,
    // Тело конструктора
  ) {
    // Передаём текст базовому классу Error
    super(message);
  }
}

// Общий запрос к API: возвращает разобранный JSON или бросает ApiError
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  // Ответ сервера
  let res: Response;
  // fetch бросает исключение, если сервер недоступен
  try {
    // Делаем запрос
    res = await fetch(url, init);
    // Сеть недоступна или бэкенд не запущен
  } catch {
    // Код 0 — «нет связи» и подсказка
    throw new ApiError(0, "Сервер не отвечает. Проверьте, что бэкенд запущен на порту 8000.");
  }
  // Ответ с ошибкой (4xx/5xx)
  if (!res.ok) {
    // Текст по умолчанию
    let message = `Ошибка ${res.status}`;
    // Пробуем достать текст из ответа FastAPI
    try {
      // Тело ответа
      const body = await res.json();
      // Наши ошибки: {"detail": "текст"}
      if (typeof body.detail === "string") message = body.detail;
      // Ошибки проверки данных: {"detail": [{"msg": "..."}]}
      else if (Array.isArray(body.detail) && body.detail[0]?.msg) message = body.detail[0].msg;
      // Тело не JSON
    } catch {
      /* тело не JSON — оставляем код ошибки */
    }
    // Бросаем ошибку
    throw new ApiError(res.status, message);
  }
  // 204 «нет содержимого» — разбирать нечего
  if (res.status === 204) return undefined as T;
  // Разбираем JSON
  return (await res.json()) as T;
}

// Все запросы приложения к серверу
export const api = {
  // Список проектов (no-store — всегда свежий, без кэша браузера)
  list: () => request<ProjectSummary[]>("/api/projects", { cache: "no-store" }),
  // Проект по id
  get: (id: string) =>
    // Проверяем формат id заранее — кривой адрес сразу даёт «не найден»
    /^[0-9a-f]{12}$/.test(id)
      // Правильный id — запрос
      ? request<Project>(`/api/projects/${id}`, { cache: "no-store" })
      // Иначе — ошибка 404 без запроса
      : Promise.reject(new ApiError(404, "Проект не найден")),
  // Создать проект одним запросом (без редактора)
  create: (file: Blob, filename: string, name: string, diameterCm: number) => {
    // Форма multipart
    const form = new FormData();
    // Файл
    form.append("file", file, filename);
    // Название, если введено
    if (name.trim()) form.append("name", name.trim());
    // Диаметр строкой
    form.append("diameter_cm", String(diameterCm));
    // Отправка
    return request<Project>("/api/projects", { method: "POST", body: form });
  },
  // Изменить проект; keepalive — запрос дойдёт, даже если страницу закрывают
  update: (id: string, patch: ProjectPatch, keepalive = false) =>
    // PATCH-запрос
    request<Project>(`/api/projects/${id}`, {
      // Метод
      method: "PATCH",
      // Тело — JSON
      headers: { "Content-Type": "application/json" },
      // Изменения
      body: JSON.stringify(patch),
      // Не обрывать при закрытии страницы
      keepalive,
    }),
  // Удалить проект
  remove: (id: string) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),
  // Возможности сервера
  features: async (): Promise<Features> => (await request<{ features: Features }>("/api/config")).features,
  // Версия программы
  appInfo: async (): Promise<AppInfo | null> => (await request<{ app?: AppInfo }>("/api/config")).app ?? null,
  // Отметка времени плетения
  activity: (id: string, body: { date: string; seconds: number; steps: number }, keepalive = false) =>
    // POST-запрос
    request<Activity>(`/api/projects/${id}/activity`, {
      // Метод
      method: "POST",
      // JSON
      headers: { "Content-Type": "application/json" },
      // Дата, секунды, шаги
      body: JSON.stringify(body),
      // Отправляется и при закрытии вкладки
      keepalive,
    }),
  // Загрузить фото в редактор
  uploadImage: (file: Blob, filename: string) => {
    // Форма
    const form = new FormData();
    // Файл
    form.append("file", file, filename);
    // Отправка
    return request<ImageInfo>("/api/images", { method: "POST", body: form });
  },
  // Информация о фото
  image: (id: string) => request<ImageInfo>(`/api/images/${id}`),
  // Создать проект из фото редактора
  createFromImage: (body: { image_id: string; name: string; diameter_cm: number; prep: Prep; threads?: ThreadChoice }) =>
    // POST-запрос
    request<Project>("/api/projects/from-image", {
      // Метод
      method: "POST",
      // JSON
      headers: { "Content-Type": "application/json" },
      // Пустое название → null (сервер подставит «Портрет от …»); нити — отдельными полями
      body: JSON.stringify({ ...threadFields(body.threads), ...withoutThreads(body), name: body.name.trim() || null }),
    }),
  // Новые настройки фото проекта (пересчёт схемы)
  updatePhoto: (id: string, prep: Prep, threads?: ThreadChoice) =>
    // PUT-запрос
    request<Project>(`/api/projects/${id}/photo`, {
      // Метод
      method: "PUT",
      // JSON
      headers: { "Content-Type": "application/json" },
      // Настройки кадра и, если переданы, нити
      body: JSON.stringify({ ...prep, ...threadFields(threads) }),
    }),
  // Кривая сходства (необязательно — для другого диаметра)
  similarity: (id: string, diameterCm?: number, layer = 0) => {
    // Параметры запроса
    const q = new URLSearchParams();
    // Диаметр — только если передан
    if (diameterCm !== undefined) q.set("diameter_cm", String(diameterCm));
    // Слой — только для второй нити и дальше
    if (layer > 0) q.set("layer", String(layer));
    // Строка параметров
    const query = q.toString();
    // GET-запрос
    return request<Similarity>(`/api/projects/${id}/similarity${query ? `?${query}` : ""}`);
  },
  // Каталог нитей и досок
  palette: async (): Promise<Palette | null> => (await request<{ palette?: Palette }>("/api/config")).palette ?? null,
  // Автонастройка яркости и контраста
  autoTone: (imageId: string, prep: Prep, diameterCm: number) =>
    // POST-запрос
    request<AutoTone>(`/api/images/${imageId}/auto-tone`, {
      // Метод
      method: "POST",
      // JSON
      headers: { "Content-Type": "application/json" },
      // Текущий кадр и диаметр
      body: JSON.stringify({ prep, diameter_cm: diameterCm }),
    }),
  // Адрес оригинала фото
  imageUrl: (id: string) => `/api/images/${id}/original.jpg`,
  // Адрес маски фона
  maskUrl: (id: string) => `/api/images/${id}/mask.png`,
  // Адрес превью картины нужного размера (и, по желанию, числа линий)
  previewUrl: (id: string, size: number, lines?: number) =>
    // Строка адреса с параметрами
    `/api/projects/${id}/preview.png?size=${size}${lines ? `&lines=${lines}` : ""}`,
  // Адрес подготовленного фото проекта
  sourceUrl: (id: string) => `/api/projects/${id}/source.png`,
  // Адрес PDF-инструкции
  pdfUrl: (id: string) => `/api/projects/${id}/instructions.pdf`,
  // Адрес шаблона разметки
  templateUrl: (id: string, paper: "A4" | "A3" = "A4") => `/api/projects/${id}/template.pdf?paper=${paper}`,
  // Файл проекта .nitegraf (перенос на другой компьютер или в телефон)
  exportUrl: (id: string) => `/api/projects/${id}/export`,
  // Открыть файл проекта — новый портрет со всем прогрессом
  importFile: (file: Blob, filename: string) => {
    // Форма с файлом
    const form = new FormData();
    // Поле file
    form.append("file", file, filename);
    // POST-запрос
    return request<Project>("/api/projects/import", { method: "POST", body: form });
  },
};
