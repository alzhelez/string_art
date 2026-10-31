// @vitest-environment node
// Версия для телефона: «сервер» в браузере отвечает так же, как Python-бэкенд (TC-API-35)

// Описание тестов, хуки и проверки
import { beforeEach, describe, expect, it } from "vitest";
// «Сырой» кодек картинок для тестов
import { rawCodec, rawImage } from "@/lib/local/codec";
// Сервер
import { LocalServer } from "@/lib/local/server";
// Хранилище в памяти
import { MemoryStore } from "@/lib/local/store";
// base64 для файла проекта
import { toB64 } from "@/lib/local/transfer";

// Адрес сайта, как на GitHub Pages
const BASE = "http://local/string_art";
// Сервер текущего теста
let server: LocalServer;
// Его хранилище
let store: MemoryStore;
// Подсказки о ходе расчёта
let notes: string[];

// Фото 300×200: светлый фон, тёмный круг-«лицо» в центре
function photo(w = 300, h = 200): Uint8Array {
  // Пиксели
  const px = new Uint8Array(w * h * 4);
  // Каждая точка
  for (let y = 0; y < h; y++) {
    // Каждый столбец
    for (let x = 0; x < w; x++) {
      // Внутри круга — тёмное, снаружи — светлый градиент
      const v = Math.hypot(x - w / 2, y - h / 2) < h / 3 ? 40 : 200 + Math.round((x / w) * 50);
      // Серый пиксель
      px.set([v, v, v, 255], (y * w + x) * 4);
    }
  }
  // «Файл»
  return rawImage(px, w, h);
}

// Запрос к серверу
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  // Тело: форма или байты как есть, иначе JSON
  const raw = body instanceof FormData || body instanceof Uint8Array ? body : body === undefined ? undefined : JSON.stringify(body);
  // Заголовок JSON для объектов
  const h = body !== undefined && !(body instanceof FormData) && !(body instanceof Uint8Array) ? { "Content-Type": "application/json", ...headers } : headers;
  // Ответ
  const res = await server.handle(new Request(`${BASE}${path}`, { method, body: raw as BodyInit | undefined, headers: h }));
  // Тело ответа: JSON или байты
  const type = res.headers.get("Content-Type") ?? "";
  // Разбор
  const data = res.status === 204 ? null : type.includes("json") ? await res.json() : new Uint8Array(await res.arrayBuffer());
  // Код, данные, заголовки
  return { status: res.status, data, headers: res.headers };
}

// Форма с файлом
function form(file: Uint8Array, name = "photo.raw", fields: Record<string, string> = {}): FormData {
  // Форма
  const f = new FormData();
  // Файл
  f.append("file", new Blob([file as BlobPart]), name);
  // Поля
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  // Форма
  return f;
}

// Загрузить фото и сделать портрет
async function portrait(extra: Record<string, unknown> = {}) {
  // Фото
  const img = await call("POST", "/api/images", form(photo()));
  // Портрет
  const p = await call("POST", "/api/projects/from-image", { image_id: img.data.id, name: "Мама", ...extra });
  // Проверка
  expect(p.status, JSON.stringify(p.data)).toBe(201);
  // Портрет
  return p.data;
}

// Перед каждым тестом — пустой «телефон»
beforeEach(() => {
  // Хранилище
  store = new MemoryStore();
  // Подсказки
  notes = [];
  // Сервер
  server = new LocalServer(store, rawCodec, (n) => notes.push(n));
});

// Группа: служебные адреса
describe("служебные адреса", () => {
  // Сервер жив, настройки версии для телефона
  it("health и config: без лица, фона и PDF, local", async () => {
    // Жив
    expect((await call("GET", "/api/health")).data).toEqual({ status: "ok" });
    // Настройки
    const cfg = (await call("GET", "/api/config")).data;
    // Возможности
    expect(cfg.features).toEqual({ face_detection: false, background_removal: false, pdf: false, local: true });
    // «Программа»
    expect(cfg.app).toEqual({ version: "phone", desktop: false, update: false });
    // Справочник нитей
    expect(cfg.palette.threads).toHaveLength(13);
    // Линии и диаметр как у бэкенда
    expect([cfg.lines.min, cfg.lines.max, cfg.total_nails, cfg.diameter.default_cm]).toEqual([1000, 5000, 240, 50]);
  });

  // Обновления в одну кнопку нет
  it("update: недоступно", async () => {
    // Состояние
    expect((await call("GET", "/api/update")).data).toMatchObject({ state: "idle", supported: false });
    // Старт — 404
    expect((await call("POST", "/api/update")).status).toBe(404);
  });

  // Справка по диаметру и неизвестный адрес
  it("geometry, 404 на неизвестный адрес", async () => {
    // 70 см → 9,16 мм и 2800 линий
    expect((await call("GET", "/api/geometry?diameter_cm=70")).data).toEqual({ diameter_cm: 70, nail_spacing_mm: 9.16, recommended_lines: 2800 });
    // Вне пределов
    expect((await call("GET", "/api/geometry?diameter_cm=10")).status).toBe(422);
    // Неизвестный
    expect((await call("GET", "/api/nothing")).status).toBe(404);
    // Шаблон без проекта — объяснение
    expect((await call("GET", "/api/template.pdf?diameter_cm=50")).data.detail).toContain("программе на компьютере");
  });
});

// Группа: фото
describe("фото", () => {
  // Загрузка и сведения
  it("загрузка: 201, сведения, оригинал; не картинка — 400", async () => {
    // Загрузка
    const r = await call("POST", "/api/images", form(photo()));
    // Создано
    expect(r.status).toBe(201);
    // Размеры, без лиц и маски
    expect(r.data).toMatchObject({ width: 300, height: 200, faces: [], has_mask: false });
    // Сведения
    expect((await call("GET", `/api/images/${r.data.id}`)).data.id).toBe(r.data.id);
    // Оригинал — те же байты
    expect((await call("GET", `/api/images/${r.data.id}/original.jpg`)).data).toEqual(photo());
    // Не картинка
    expect((await call("POST", "/api/images", form(new TextEncoder().encode("hello")))).status).toBe(400);
    // Пустой файл
    expect((await call("POST", "/api/images", form(new Uint8Array()))).status).toBe(400);
    // Без файла
    expect((await call("POST", "/api/images", new FormData())).status).toBe(422);
    // Неизвестное фото
    expect((await call("GET", "/api/images/000000000000")).status).toBe(404);
  });

  // Маска: убрать фон нельзя, но маска из файла с компьютера работает
  it("маска: без маски — 503, своя маска — готова, сброс без автоматической — 503", async () => {
    // Фото
    const img = (await call("POST", "/api/images", form(photo()))).data;
    // Состояние маски — объяснение
    const st = await call("POST", `/api/images/${img.id}/mask`);
    // 503 и текст
    expect([st.status, st.data.detail]).toEqual([503, expect.stringContaining("программа на компьютере")]);
    // Маски нет — 409
    expect((await call("GET", `/api/images/${img.id}/mask.png`)).status).toBe(409);
    // Своя маска (белая — всё «человек»)
    const mask = rawImage(new Uint8Array(300 * 200 * 4).fill(255), 300, 200);
    // Сохраняем
    const put = await call("PUT", `/api/images/${img.id}/mask.png`, mask);
    // Готова, поправлена
    expect(put.data).toMatchObject({ status: "ready", edited: true });
    // Отдаётся
    expect((await call("GET", `/api/images/${img.id}/mask.png`)).data).toEqual(mask);
    // Портрет с убранным фоном считается по ней
    expect((await call("POST", "/api/projects/from-image", { image_id: img.id, prep: { remove_background: true } })).status).toBe(201);
    // Не картинка — 400
    expect((await call("PUT", `/api/images/${img.id}/mask.png`, new TextEncoder().encode("x"))).status).toBe(400);
    // Сброс правок без автоматической маски — 503
    expect((await call("DELETE", `/api/images/${img.id}/mask/edits`)).status).toBe(503);
  });

  // Лица в телефоне нет
  it("«Выделить лицо» — 422 с пояснением", async () => {
    // Фото
    const img = (await call("POST", "/api/images", form(photo()))).data;
    // Портрет с лицом
    const r = await call("POST", "/api/projects/from-image", { image_id: img.id, prep: { face_focus: true } });
    // Понятная ошибка
    expect([r.status, r.data.detail]).toEqual([422, expect.stringContaining("Выделить лицо")]);
  });
});

// Группа: портреты
describe("портреты", () => {
  // Создание, список, чтение
  it("from-image: схема 5001 гвоздь, рекомендация, одна нить", async () => {
    // Портрет
    const p = await portrait({ diameter_cm: 60 });
    // Схема
    expect(p.sequence).toHaveLength(5001);
    // Рекомендация в пределах
    expect(p.line_count).toBeGreaterThanOrEqual(1000);
    // Режим и слой
    expect([p.mode, p.board.key, p.layers.length, p.layers[0].color]).toEqual(["mono", "white", 1, "black"]);
    // Диаметр, шаг, название
    expect([p.diameter_cm, p.current_step, p.name]).toEqual([60, 1, "Мама"]);
    // Расход лески посчитан
    expect(p.stats.total_length_m).toBeGreaterThan(0);
    // Подсказки о ходе расчёта были
    expect(notes).toContain("Считаем схему…");
    // В списке — без схемы
    const list = (await call("GET", "/api/projects")).data;
    // Один портрет без sequence
    expect([list.length, "sequence" in list[0]]).toEqual([1, false]);
    // Чтение
    expect((await call("GET", `/api/projects/${p.id}`)).data.sequence).toEqual(p.sequence);
    // Неизвестный id
    expect((await call("GET", "/api/projects/zzz")).status).toBe(404);
  });

  // Ошибки создания
  it("from-image: лишние поля, неизвестное фото, плохой диаметр", async () => {
    // Лишнее поле
    expect((await call("POST", "/api/projects/from-image", { image_id: "000000000000", x: 1 })).status).toBe(422);
    // Неизвестное фото
    expect((await call("POST", "/api/projects/from-image", { image_id: "000000000000" })).status).toBe(404);
    // Фото
    const img = (await call("POST", "/api/images", form(photo()))).data;
    // Диаметр вне пределов
    expect((await call("POST", "/api/projects/from-image", { image_id: img.id, diameter_cm: 5 })).status).toBe(422);
    // Зум вне пределов
    expect((await call("POST", "/api/projects/from-image", { image_id: img.id, prep: { zoom: 9 } })).status).toBe(422);
    // Неизвестный режим
    expect((await call("POST", "/api/projects/from-image", { image_id: img.id, mode: "rainbow" })).status).toBe(422);
    // Неизвестная доска
    expect((await call("POST", "/api/projects/from-image", { image_id: img.id, mode: "bw", board: "pink" })).status).toBe(422);
    // Не JSON
    expect((await call("POST", "/api/projects/from-image", new TextEncoder().encode("{"))).status).toBe(422);
  });

  // Портрет сразу из файла (POST /api/projects)
  it("POST /api/projects: название из имени файла", async () => {
    // Портрет из файла
    const r = await call("POST", "/api/projects", form(photo(), "Бабушка.raw", { diameter_cm: "40" }));
    // Создан, название из файла, диаметр из формы
    expect([r.status, r.data.name, r.data.diameter_cm]).toEqual([201, "Бабушка", 40]);
  });

  // Изменения
  it("PATCH: шаг, линии, катушка, ошибки", async () => {
    // Портрет
    const p = await portrait();
    // Шаг, скорость, своя катушка, название
    const r = await call("PATCH", `/api/projects/${p.id}`, { current_step: 120, speed_sec: 3.44, own_spool_m: 700, name: "  Папа " });
    // Сохранилось (скорость округлена)
    expect([r.data.current_step, r.data.speed_sec, r.data.own_spool_m, r.data.name]).toEqual([120, 3.4, 700, "Папа"]);
    // Сбросить катушку
    expect((await call("PATCH", `/api/projects/${p.id}`, { own_spool_m: null })).data.own_spool_m).toBeNull();
    // Линий меньше шага — шаг прижимается
    expect((await call("PATCH", `/api/projects/${p.id}`, { current_step: 1000, line_count: 1000 })).data.current_step).toBe(1000);
    // Меньше 1000 у одной нити — 422
    expect((await call("PATCH", `/api/projects/${p.id}`, { line_count: 500 })).status).toBe(422);
    // Шаг дальше конца
    expect((await call("PATCH", `/api/projects/${p.id}`, { current_step: 4999 })).status).toBe(422);
    // Пустое название
    expect((await call("PATCH", `/api/projects/${p.id}`, { name: "  " })).status).toBe(422);
    // Лишнее поле
    expect((await call("PATCH", `/api/projects/${p.id}`, { color: "red" })).status).toBe(422);
    // Нет такой нити
    expect((await call("PATCH", `/api/projects/${p.id}`, { layer: 1, current_step: 2 })).status).toBe(422);
  });

  // Учёт времени
  it("activity: складывает по дням, проверяет данные", async () => {
    // Портрет
    const p = await portrait();
    // Две отметки за день
    await call("POST", `/api/projects/${p.id}/activity`, { date: "2026-11-01", seconds: 30, steps: 5 });
    // Вторая
    const a = (await call("POST", `/api/projects/${p.id}/activity`, { date: "2026-11-01", seconds: 12.5, steps: 2 })).data;
    // Итог
    expect(a).toEqual({ total_sec: 42.5, total_steps: 7, days: [{ date: "2026-11-01", sec: 42.5, steps: 7 }] });
    // Неверная дата
    expect((await call("POST", `/api/projects/${p.id}/activity`, { date: "вчера", seconds: 1, steps: 1 })).status).toBe(422);
    // Слишком много секунд
    expect((await call("POST", `/api/projects/${p.id}/activity`, { date: "2026-11-01", seconds: 9999, steps: 1 })).status).toBe(422);
  });

  // Шаги, превью, подготовленное фото, сходство, PDF
  it("steps, preview, source, similarity, PDF", async () => {
    // Портрет
    const p = await portrait();
    // Страница шагов
    const s = (await call("GET", `/api/projects/${p.id}/steps?offset=0&limit=2`)).data;
    // Первый шаг — из A1
    expect([s.total, s.items.length, s.items[0].number, s.items[0].from_label]).toEqual([p.line_count, 2, 1, "A1"]);
    // Леска растёт
    expect(s.items[1].thread_used_m).toBeGreaterThan(s.items[0].thread_used_m);
    // Нет такой нити
    expect((await call("GET", `/api/projects/${p.id}/steps?layer=2`)).status).toBe(422);
    // Превью 200×200
    const prev = await call("GET", `/api/projects/${p.id}/preview.png?size=200&lines=1000`);
    // Картинка нужного размера
    expect([prev.headers.get("Content-Type"), (await rawCodec.open(prev.data)).width]).toEqual(["image/png", 200]);
    // Подготовленное фото 400×400
    expect((await rawCodec.open((await call("GET", `/api/projects/${p.id}/source.png`)).data)).width).toBe(400);
    // Кривая сходства: 1000…5000 через 100
    const sim = (await call("GET", `/api/projects/${p.id}/similarity`)).data;
    // 41 точка, лучшая — рекомендация
    expect([sim.curve.length, sim.best_lines, sim.diameter_cm]).toEqual([41, p.line_count, 50]);
    // Другой диаметр
    expect((await call("GET", `/api/projects/${p.id}/similarity?diameter_cm=30`)).data.diameter_cm).toBe(30);
    // PDF нет — объяснение
    expect((await call("GET", `/api/projects/${p.id}/instructions.pdf`)).data.detail).toContain("программе на компьютере");
  });

  // Изменить фото
  it("PUT photo: пересчёт, прогресс с начала, смена режима", async () => {
    // Портрет с прогрессом
    const p = await portrait();
    // Шаг 500
    await call("PATCH", `/api/projects/${p.id}`, { current_step: 500 });
    // Новый кадр и режим «чёрная + белая»
    const r = await call("PUT", `/api/projects/${p.id}/photo`, { zoom: 1.5, mode: "bw" });
    // Пересчитан: две нити, доска серая, шаг с начала
    expect([r.status, r.data.mode, r.data.board.key, r.data.layers.length, r.data.current_step, r.data.prep.zoom]).toEqual([200, "bw", "gray", 2, 1, 1.5]);
    // Нить второго слоя: прогресс отдельно
    const l = await call("PATCH", `/api/projects/${p.id}`, { layer: 1, current_step: 42, current_layer: 1 });
    // Сохранилось у второй нити
    expect([l.data.layers[1].current_step, l.data.current_layer, l.data.layers[0].current_step]).toEqual([42, 1, 1]);
    // Кривая второй нити
    expect((await call("GET", `/api/projects/${p.id}/similarity?layer=1`)).data.curve[0].lines).toBe(100);
    // Превью цветное (доска серая)
    expect((await call("GET", `/api/projects/${p.id}/preview.png?size=100`)).status).toBe(200);
    // Ниже — предел времени теста: расчёт портрета идёт по-настоящему
  }, 60_000);

  // Удаление
  it("DELETE: 204, фото без портрета удаляется", async () => {
    // Портрет
    const p = await portrait();
    // Удаляем
    expect((await call("DELETE", `/api/projects/${p.id}`)).status).toBe(204);
    // Портрета нет
    expect((await call("GET", `/api/projects/${p.id}`)).status).toBe(404);
    // Фото тоже
    expect(await store.getImage(p.image_id)).toBeNull();
  });
});

// Группа: файл проекта (тот же формат, что у программы на компьютере)
describe("файл .nitegraf", () => {
  // Сохранить и открыть
  it("export → import: новый портрет с тем же прогрессом и фото", async () => {
    // Портрет с прогрессом
    const p = await portrait();
    // Прогресс и время
    await call("PATCH", `/api/projects/${p.id}`, { current_step: 321, own_spool_m: 450 });
    // Время плетения
    await call("POST", `/api/projects/${p.id}/activity`, { date: "2026-10-31", seconds: 60, steps: 12 });
    // Файл
    const file = await call("GET", `/api/projects/${p.id}/export`);
    // Вложение с русским именем
    expect(file.headers.get("Content-Disposition")).toContain(encodeURIComponent("Мама.nitegraf"));
    // Содержимое (ответ JSON — уже разобран)
    const data = file.data;
    // Формат и прогресс
    expect([data.format, data.version, data.app, data.project.current_step, data.project.activity]).toEqual(["nitegraf", 1, "phone", 321, { "2026-10-31": [60, 12] }]);
    // Открываем
    const copy = await call("POST", "/api/projects/import", form(new TextEncoder().encode(JSON.stringify(data)), "Мама.nitegraf"));
    // Новый портрет
    expect(copy.status).toBe(201);
    // Тот же прогресс, схема, катушка; своё фото
    expect([copy.data.id !== p.id, copy.data.current_step, copy.data.own_spool_m, copy.data.sequence, copy.data.image_id !== p.image_id]).toEqual([true, 321, 450, p.sequence, true]);
    // «Изменить фото» у копии работает
    expect((await call("PUT", `/api/projects/${copy.data.id}/photo`, { zoom: 1.2 })).status).toBe(200);
  });

  // Испорченные файлы — те же коды и тексты, что у бэкенда
  it("import: не JSON — 400, испорчен — 422 с полем", async () => {
    // Портрет
    const p = await portrait();
    // Файл
    const good = (await call("GET", `/api/projects/${p.id}/export`)).data;
    // Отправить изменённый файл
    const send = (d: unknown) => call("POST", "/api/projects/import", form(new TextEncoder().encode(typeof d === "string" ? d : JSON.stringify(d))));
    // Не JSON
    expect((await send("hello")).data.detail).toBe("Это не файл проекта «Нитеграфа»");
    // Чужой формат
    expect((await send({ ...good, format: "other" })).status).toBe(400);
    // Гвоздь вне круга
    expect((await send({ ...good, project: { ...good.project, sequence: [0, 999] } })).data.detail).toBe("Файл проекта испорчен: Номер гвоздя вне 0…239 (project.sequence)");
    // Будущая версия
    expect((await send({ ...good, version: 99 })).data.detail).toContain("обновите «Нитеграф»");
    // Неизвестная доска
    expect((await send({ ...good, project: { ...good.project, board: "rainbow" } })).status).toBe(422);
    // Лишнее поле
    expect((await send({ ...good, extra: 1 })).data.detail).toContain("(extra)");
    // Одна нить, но есть слои
    expect((await send({ ...good, project: { ...good.project, layers: [{ color: "black", sequence: [0, 120], line_count: 1 }] } })).data.detail).toContain("Режим не совпадает");
    // Испорченный base64
    expect((await send({ ...good, source_png: "@@@" })).data.detail).toContain("испорченные данные");
    // Не картинка внутри
    expect((await send({ ...good, source_png: "aGVsbG8=" })).data.detail).toBe("Подготовленное фото испорчено");
    // Испорченный учёт времени
    expect((await send({ ...good, project: { ...good.project, activity: { вчера: [1, 1] } } })).data.detail).toContain("Учёт времени испорчен");
  });

  // Цветной портрет переносится со всеми нитями
  it("цветной портрет: все нити и текущая нить", async () => {
    // Две нити вручную
    const p = await portrait({ mode: "color", colors: ["red", "black"], board: "beige" });
    // Вторая нить, шаг 42
    await call("PATCH", `/api/projects/${p.id}`, { layer: 1, current_step: 42, current_layer: 1 });
    // Файл
    const file = (await call("GET", `/api/projects/${p.id}/export`)).data;
    // Открываем
    const copy = (await call("POST", "/api/projects/import", form(new TextEncoder().encode(JSON.stringify(file))))).data;
    // Режим, доска, текущая нить, прогресс второй нити
    expect([copy.mode, copy.board.key, copy.current_layer, copy.layers.map((l: { color: string }) => l.color), copy.layers[1].current_step]).toEqual([
      // Ожидание
      "color", "beige", 1, p.layers.map((l: { color: string }) => l.color), 42,
    ]);
    // Ниже — предел времени теста: расчёт портрета идёт по-настоящему
  }, 60_000);
});

// Группа: автонастройка
describe("автонастройка", () => {
  // 6 вариантов
  it("auto-tone: лучший вариант не хуже исходного", async () => {
    // Фото
    const img = (await call("POST", "/api/images", form(photo()))).data;
    // Перебор
    const r = await call("POST", `/api/images/${img.id}/auto-tone`, { prep: {}, diameter_cm: 50 });
    // 6 вариантов, не хуже
    expect([r.status, r.data.candidates, r.data.score_after >= r.data.score_before]).toEqual([200, 6, true]);
    // Лишнее поле
    expect((await call("POST", `/api/images/${img.id}/auto-tone`, { x: 1 })).status).toBe(422);
    // Ниже — предел времени теста: расчёт портрета идёт по-настоящему
  }, 120_000);
});

// Группа: файлы с компьютера и уборка
describe("файл без фото и уборка", () => {
  // Старый портрет без фото (с компьютера) открывается
  it("файл без фото: открывается, мало линий у одной нити — 422", async () => {
    // Схема из 1001 гвоздя
    const seq = [0, ...Array.from({ length: 1000 }, (_, i) => ((i + 1) * 17) % 240)];
    // Подготовленное фото
    const src = toB64(rawImage(new Uint8Array(400 * 400 * 4).fill(255), 400, 400));
    // Файл как с компьютера
    const file = { format: "nitegraf", version: 1, app: "1.4.20", project: { name: "Старый", diameter_cm: 40, line_count: 1000, sequence: seq, activity: { "2026-10-27": [120, 30] } }, source_png: src, image: null };
    // Отправить
    const send = (d: unknown) => call("POST", "/api/projects/import", form(new TextEncoder().encode(JSON.stringify(d)), "p.nitegraf"));
    // Открылся
    const ok = await send(file);
    // Без фото, тот же учёт времени
    expect([ok.status, ok.data.image_id, ok.data.activity.total_sec]).toEqual([201, null, 120]);
    // У одной нити меньше 1000 линий — ошибка
    expect((await send({ ...file, project: { ...file.project, line_count: 500 } })).data.detail).toContain("от 1000");
    // «Изменить фото» без фото — 409
    expect((await call("PUT", `/api/projects/${ok.data.id}/photo`, {})).status).toBe(409);
  });

  // Фото без портрета старше суток удаляется при открытии списка
  it("старые фото без портрета удаляются", async () => {
    // Фото
    const img = (await call("POST", "/api/images", form(photo()))).data;
    // Запись
    const row = (await store.getImage(img.id))!;
    // «Загружено» два дня назад
    await store.putImage({ ...row, created_at: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    // Список
    await call("GET", "/api/projects");
    // Удалено
    expect(await store.getImage(img.id)).toBeNull();
  });
});
