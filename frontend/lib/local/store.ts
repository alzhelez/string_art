// Версия для телефона: хранилище портретов и фото в самом браузере (IndexedDB).
// Те же поля, что в SQLite на бэкенде. Для тестов есть хранилище в памяти.

/** Слой цветного портрета в базе. */
export interface StoredLayer {
  // Ключ нити
  color: string;
  // Схема
  sequence: number[];
  // Сколько линий плести
  line_count: number;
  // Текущий шаг
  current_step: number;
}

/** Портрет в базе (как строка таблицы projects). */
export interface ProjectRow {
  // id из 12 знаков
  id: string;
  // Название
  name: string;
  // Создан (ISO, UTC)
  created_at: string;
  // Изменён
  updated_at: string;
  // Диаметр, см
  diameter_cm: number;
  // Сколько линий плести
  line_count: number;
  // Текущий шаг
  current_step: number;
  // Скорость автоперелистывания, с
  speed_sec: number;
  // Фото, из которого сделан портрет
  image_id: string | null;
  // Параметры кадра
  prep: Record<string, unknown>;
  // Своя катушка, м
  own_spool_m: number | null;
  // Учёт времени: дата → [секунды, шаги]
  activity: Record<string, [number, number]>;
  // Режим нитей
  mode: string;
  // Доска
  board: string;
  // Слои (пусто — одна чёрная нить)
  layers: StoredLayer[];
  // Текущая нить
  current_layer: number;
  // Схема (первый слой)
  sequence: number[];
}

/** Фото в базе. */
export interface ImageRow {
  // id
  id: string;
  // Загружено (ISO)
  created_at: string;
  // Ширина
  width: number;
  // Высота
  height: number;
  // Найденные лица
  faces: { x: number; y: number; w: number; h: number }[];
  // Оригинал (JPEG)
  original: Uint8Array;
  // Маска фона (PNG) или null
  mask: Uint8Array | null;
  // Автоматическая маска (до правок кистью)
  mask_auto: Uint8Array | null;
  // Откуда маска: auto, edited или null
  mask_source: "auto" | "edited" | null;
}

/** Что умеет хранилище. */
export interface Store {
  // Все портреты
  listProjects(): Promise<ProjectRow[]>;
  // Один портрет
  getProject(id: string): Promise<ProjectRow | null>;
  // Записать портрет
  putProject(row: ProjectRow): Promise<void>;
  // Удалить портрет
  deleteProject(id: string): Promise<void>;
  // Подготовленное фото портрета (PNG)
  getSource(id: string): Promise<Uint8Array | null>;
  // Записать подготовленное фото
  putSource(id: string, png: Uint8Array): Promise<void>;
  // Все фото
  listImages(): Promise<ImageRow[]>;
  // Одно фото
  getImage(id: string): Promise<ImageRow | null>;
  // Записать фото
  putImage(row: ImageRow): Promise<void>;
  // Удалить фото
  deleteImage(id: string): Promise<void>;
}

/** Хранилище в памяти (тесты и браузеры без IndexedDB). */
export class MemoryStore implements Store {
  // Портреты
  private projects = new Map<string, ProjectRow>();
  // Подготовленные фото
  private sources = new Map<string, Uint8Array>();
  // Фото
  private images = new Map<string, ImageRow>();

  // Все портреты (копии)
  async listProjects() {
    // Копии
    return [...this.projects.values()].map((p) => structuredClone(p));
  }
  // Один портрет
  async getProject(id: string) {
    // Копия или null
    const p = this.projects.get(id);
    // Отдаём
    return p ? structuredClone(p) : null;
  }
  // Записать
  async putProject(row: ProjectRow) {
    // Копия
    this.projects.set(row.id, structuredClone(row));
  }
  // Удалить
  async deleteProject(id: string) {
    // Портрет
    this.projects.delete(id);
    // И его фото
    this.sources.delete(id);
  }
  // Подготовленное фото
  async getSource(id: string) {
    // Байты или null
    return this.sources.get(id) ?? null;
  }
  // Записать
  async putSource(id: string, png: Uint8Array) {
    // Байты
    this.sources.set(id, png);
  }
  // Все фото
  async listImages() {
    // Копии
    return [...this.images.values()].map((i) => structuredClone(i));
  }
  // Одно фото
  async getImage(id: string) {
    // Копия или null
    const i = this.images.get(id);
    // Отдаём
    return i ? structuredClone(i) : null;
  }
  // Записать
  async putImage(row: ImageRow) {
    // Копия
    this.images.set(row.id, structuredClone(row));
  }
  // Удалить
  async deleteImage(id: string) {
    // Удаляем
    this.images.delete(id);
  }
}

// Имя базы
const DB_NAME = "nitegraf";
// Версия схемы
const DB_VERSION = 1;
// Таблицы
const TABLES = ["projects", "sources", "images"] as const;

// Запрос IndexedDB → обещание
function done<T>(req: IDBRequest<T>): Promise<T> {
  // Ждём успеха или ошибки
  return new Promise((resolve, reject) => {
    // Успех
    req.onsuccess = () => resolve(req.result);
    // Ошибка
    req.onerror = () => reject(req.error);
  });
}

/** Хранилище в IndexedDB браузера. */
export class IdbStore implements Store {
  // Открытая база
  private db: Promise<IDBDatabase>;

  // Открываем базу при создании
  constructor(name = DB_NAME) {
    // Открытие
    this.db = new Promise((resolve, reject) => {
      // Запрос
      const req = indexedDB.open(name, DB_VERSION);
      // Первое открытие — создаём таблицы
      req.onupgradeneeded = () => {
        // Каждая таблица
        for (const t of TABLES) if (!req.result.objectStoreNames.contains(t)) req.result.createObjectStore(t);
      };
      // Открыта
      req.onsuccess = () => resolve(req.result);
      // Ошибка (например, приватный режим старого Safari)
      req.onerror = () => reject(req.error);
    });
  }

  // Таблица для чтения или записи
  private async table(name: (typeof TABLES)[number], mode: IDBTransactionMode) {
    // Транзакция и таблица
    return (await this.db).transaction(name, mode).objectStore(name);
  }

  // Прочитать значение
  private async get<T>(name: (typeof TABLES)[number], id: string): Promise<T | null> {
    // Значение или null
    return ((await done((await this.table(name, "readonly")).get(id))) as T | undefined) ?? null;
  }

  // Записать значение
  private async put(name: (typeof TABLES)[number], id: string, value: unknown): Promise<void> {
    // Запись
    await done((await this.table(name, "readwrite")).put(value, id));
  }

  // Удалить значение
  private async remove(name: (typeof TABLES)[number], id: string): Promise<void> {
    // Удаление
    await done((await this.table(name, "readwrite")).delete(id));
  }

  // Все портреты
  async listProjects() {
    // Все значения таблицы
    return (await done((await this.table("projects", "readonly")).getAll())) as ProjectRow[];
  }
  // Один портрет
  getProject(id: string) {
    // Чтение
    return this.get<ProjectRow>("projects", id);
  }
  // Записать
  putProject(row: ProjectRow) {
    // Запись
    return this.put("projects", row.id, row);
  }
  // Удалить портрет и его подготовленное фото
  async deleteProject(id: string) {
    // Портрет
    await this.remove("projects", id);
    // Фото
    await this.remove("sources", id);
  }
  // Подготовленное фото
  getSource(id: string) {
    // Чтение
    return this.get<Uint8Array>("sources", id);
  }
  // Записать
  putSource(id: string, png: Uint8Array) {
    // Запись
    return this.put("sources", id, png);
  }
  // Все фото
  async listImages() {
    // Все значения
    return (await done((await this.table("images", "readonly")).getAll())) as ImageRow[];
  }
  // Одно фото
  getImage(id: string) {
    // Чтение
    return this.get<ImageRow>("images", id);
  }
  // Записать
  putImage(row: ImageRow) {
    // Запись
    return this.put("images", row.id, row);
  }
  // Удалить
  deleteImage(id: string) {
    // Удаление
    return this.remove("images", id);
  }
}
