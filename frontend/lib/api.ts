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
}

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
}

// Что можно менять запросом PATCH — часть полей проекта, каждое необязательно
export type ProjectPatch = Partial<
  // Выбранные поля
  Pick<Project, "name" | "diameter_cm" | "line_count" | "current_step" | "speed_sec" | "own_spool_m">
>;

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
  createFromImage: (body: { image_id: string; name: string; diameter_cm: number; prep: Prep }) =>
    // POST-запрос
    request<Project>("/api/projects/from-image", {
      // Метод
      method: "POST",
      // JSON
      headers: { "Content-Type": "application/json" },
      // Пустое название → null (сервер подставит «Портрет от …»)
      body: JSON.stringify({ ...body, name: body.name.trim() || null }),
    }),
  // Новые настройки фото проекта (пересчёт схемы)
  updatePhoto: (id: string, prep: Prep) =>
    // PUT-запрос
    request<Project>(`/api/projects/${id}/photo`, {
      // Метод
      method: "PUT",
      // JSON
      headers: { "Content-Type": "application/json" },
      // Настройки кадра
      body: JSON.stringify(prep),
    }),
  // Кривая сходства (необязательно — для другого диаметра)
  similarity: (id: string, diameterCm?: number) =>
    // GET-запрос
    request<Similarity>(
      // Параметр diameter_cm добавляется, только если передан
      `/api/projects/${id}/similarity${diameterCm !== undefined ? `?diameter_cm=${diameterCm}` : ""}`,
    ),
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
};
