// @vitest-environment node
// Версия для телефона: «сервер» в браузере отвечает на те же адреса /api/*, что и Python-бэкенд

// Чтение эталонного фото
import fs from "node:fs";
// Распаковка gzip
import { gunzipSync } from "node:zlib";
// Описание тестов, хуки и проверки
import { beforeEach, describe, expect, it } from "vitest";
// «Сырой» кодек для тестов
import { rawCodec, rawImage } from "@/lib/local/codec";
// Сервер
import { LocalServer } from "@/lib/local/server";
// Хранилище в памяти
import { MemoryStore } from "@/lib/local/store";
// base64
import { toB64 } from "@/lib/local/transfer";

// Эталонное серое фото 400×400 → «сырая» картинка RGBA
const ref = JSON.parse(gunzipSync(fs.readFileSync(new URL("../fixtures/parity.json.gz", import.meta.url))).toString("utf8"));
// Цвета точек
const rgb = Buffer.from(ref.rgb, "base64");
// RGBA из цветного фото
const rgba = new Uint8Array(400 * 400 * 4);
// Каждая точка
for (let p = 0; p < 400 * 400; p++) rgba.set([rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2], 255], p * 4);
// Файл фото
const PHOTO = rawImage(rgba, 400, 400);

// Сервер и хранилище — новые на каждый тест
let server: LocalServer;
// Хранилище
let store: MemoryStore;
// Подсказки о ходе расчёта
let notes: string[];

// Запрос к серверу: метод, путь, тело JSON
async function call(method: string, path: string, body?: unknown) {
  // Запрос
  const res = await server.handle(new Request(`http://local/string_art${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }));
  // Тело
  const text = res.status === 204 ? "" : await res.clone().text();
  // Ответ, JSON (если есть) и заголовки
  return { status: res.status, json: text && res.headers.get("Content-Type")?.includes("json") ? JSON.parse(text) : null, res };
}

// Отправить файл формой
async function upload(path: string, data: Uint8Array, name = "Мама.jpg", fields: Record<string, string> = {}) {
  // Форма
  const form = new FormData();
  // Файл
  form.append("file", new Blob([data as BlobPart]), name);
  // Поля
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  // Запрос
  const res = await server.handle(new Request(`http://local/string_art${path}`, { method: "POST", body: form }));
  // Ответ
  return { status: res.status, json: await res.json() };
}

// Перед каждым тестом — пустое хранилище
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
  // Сервер жив и настройки
  it("health и config: версия для телефона без лица, фона и PDF", async () => {
    // health
    expect((await call("GET", "/api/health")).json).toEqual({ status: "ok" });
    // Настройки
    const cfg = (await call("GET", "/api/config")).json;
    // Возможности
    expect(cfg.features).toEqual({ face_detection: false, background_removal: false, pdf: false, local: true });
    // Программа
    expect(cfg.app).toEqual({ version: "phone", desktop: false, update: false });
    // Справочник нитей
    expect(cfg.palette.threads).toHaveLength(13);
    // Линии и гвозди
    expect([cfg.lines.min, cfg.lines.max, cfg.total_nails]).toEqual([1000, 5000, 240]);
  });

  // Обновления и PDF нет, неизвестный адрес — 404
  it("обновление, PDF и неизвестные адреса", async () => {
    // Состояние обновления
    expect((await call("GET", "/api/update")).json.supported).toBe(false);
    // Начать нельзя
    expect((await call("POST", "/api/update")).status).toBe(404);
    // Шаблон
    expect((await call("GET", "/api/template.pdf?diameter_cm=50")).json.detail).toContain("программе на компьютере");
    // Неизвестный адрес
    expect((await call("GET", "/api/nothing")).status).toBe(404);
    // Справка по диаметру
    expect((await call("GET", "/api/geometry?diameter_cm=70")).json).toEqual({ diameter_cm: 70, nail_spacing_mm: 9.16, recommended_lines: 2800 });
    // Неверный диаметр
    expect((await call("GET", "/api/geometry?diameter_cm=5")).status).toBe(422);
  });
});

// Группа: полный путь портрета
describe("портрет целиком: фото → портрет → плетение → файл", () => {
  // Весь путь одной нити
  it("одна нить: создание, правка, учёт времени, шаги, превью, удаление", async () => {
    // Загружаем фото
    const img = await upload("/api/images", PHOTO);
    // Создано
    expect(img.status).toBe(201);
    // Размеры и без лиц
    expect(img.json).toMatchObject({ width: 400, height: 400, faces: [], has_mask: false });
    // Сведения о фото
    expect((await call("GET", `/api/images/${img.json.id}`)).json.id).toBe(img.json.id);
    // Оригинал
    expect((await call("GET", `/api/images/${img.json.id}/original.jpg`)).res.headers.get("Content-Type")).toBe("image/jpeg");
    // Портрет
    const created = await call("POST", "/api/projects/from-image", { image_id: img.json.id, name: " Мама ", diameter_cm: 50 });
    // Создан
    expect(created.status).toBe(201);
    // Портрет
    const p = created.json;
    // Поля как у бэкенда
    expect(p).toMatchObject({ name: "Мама", diameter_cm: 50, current_step: 1, mode: "mono", board: { key: "white" }, current_layer: 0 });
    // Схема на 5000 линий
    expect(p.sequence).toHaveLength(5001);
    // Число линий — по сходству; фото здесь — уже подготовленное цветное, поэтому допуск шире (±600)
    expect(Math.abs(p.line_count - ref.best[0])).toBeLessThanOrEqual(600);
    // Один слой — чёрная нить
    expect(p.layers).toEqual([expect.objectContaining({ index: 0, color: "black", line_count: p.line_count, current_step: 1 })]);
    // Подсказки о ходе расчёта
    expect(notes).toContain("Считаем схему…");
    // В списке — без схемы
    const list = (await call("GET", "/api/projects")).json;
    // Один портрет
    expect(list.map((x: { id: string }) => x.id)).toEqual([p.id]);
    // Без sequence
    expect(list[0].sequence).toBeUndefined();
    // Правка
    const patched = await call("PATCH", `/api/projects/${p.id}`, { current_step: 321, speed_sec: 3.44, own_spool_m: 700, name: "Мама 2" });
    // Поля
    expect(patched.json).toMatchObject({ current_step: 321, speed_sec: 3.4, own_spool_m: 700, name: "Мама 2" });
    // Меньше 1000 линий у одной нити — нельзя
    expect((await call("PATCH", `/api/projects/${p.id}`, { line_count: 500 })).status).toBe(422);
    // Шаг дальше конца — нельзя
    expect((await call("PATCH", `/api/projects/${p.id}`, { current_step: 5000, line_count: 1000 })).status).toBe(422);
    // Линий стало меньше — шаг прижимается
    expect((await call("PATCH", `/api/projects/${p.id}`, { line_count: 1000 })).json.current_step).toBe(321);
    // Лишнее поле — 422
    expect((await call("PATCH", `/api/projects/${p.id}`, { sequence: [] })).status).toBe(422);
    // Пустое название — 422
    expect((await call("PATCH", `/api/projects/${p.id}`, { name: "  " })).status).toBe(422);
    // Сброс своей катушки
    expect((await call("PATCH", `/api/projects/${p.id}`, { own_spool_m: null })).json.own_spool_m).toBeNull();
    // Учёт времени: два раза в один день
    await call("POST", `/api/projects/${p.id}/activity`, { date: "2026-10-28", seconds: 60.04, steps: 10 });
    // Второй раз
    const act = await call("POST", `/api/projects/${p.id}/activity`, { date: "2026-10-28", seconds: 30, steps: 5 });
    // Сумма
    expect(act.json).toEqual({ total_sec: 90, total_steps: 15, days: [{ date: "2026-10-28", sec: 90, steps: 15 }] });
    // Неверная дата
    expect((await call("POST", `/api/projects/${p.id}/activity`, { date: "вчера", seconds: 1, steps: 1 })).status).toBe(422);
    // Шаги
    const steps = (await call("GET", `/api/projects/${p.id}/steps?offset=0&limit=2`)).json;
    // Первый шаг — от A1
    expect(steps).toMatchObject({ total: 1000, offset: 0, limit: 2 });
    // Подписи гвоздей
    expect(steps.items[0]).toMatchObject({ number: 1, from_nail: 0, from_label: "A1" });
    // Сходство: кривая до 5000
    const sim = (await call("GET", `/api/projects/${p.id}/similarity`)).json;
    // 41 точка и лучшая
    expect([sim.curve.length, sim.diameter_cm]).toEqual([41, 50]);
    // Второй раз — из кэша (тот же объект)
    expect((await call("GET", `/api/projects/${p.id}/similarity`)).json).toEqual(sim);
    // Превью — картинка нужного размера
    const prev = await call("GET", `/api/projects/${p.id}/preview.png?size=200&lines=1500`);
    // Тип
    expect(prev.res.headers.get("Content-Type")).toBe("image/png");
    // Размер 200×200 («сырой» формат: 8 байт + пиксели)
    expect((await prev.res.arrayBuffer()).byteLength).toBe(8 + 200 * 200 * 4);
    // PDF нет
    expect((await call("GET", `/api/projects/${p.id}/instructions.pdf`)).status).toBe(404);
    // Удаление
    expect((await call("DELETE", `/api/projects/${p.id}`)).status).toBe(204);
    // Портрета нет
    expect((await call("GET", `/api/projects/${p.id}`)).status).toBe(404);
    // Фото тоже удалено
    expect((await call("GET", `/api/images/${img.json.id}`)).status).toBe(404);
  // Время на тест — до 2 минут
  }, 120_000);

  // Цветной портрет: слои, правка второй нити, кривая нити
  it("чёрная + белая: два слоя, прогресс каждой нити", async () => {
    // Фото
    const img = await upload("/api/images", PHOTO);
    // Портрет
    const p = (await call("POST", "/api/projects/from-image", { image_id: img.json.id, mode: "bw", board: "navy" })).json;
    // Режим и доска
    expect([p.mode, p.board.key, p.layers.length]).toEqual(["bw", "navy", 2]);
    // Первый слой — зеркало полей портрета
    expect(p.layers[0].sequence).toEqual(p.sequence);
    // Вторая нить: шаг 42, текущая нить — вторая
    const patched = (await call("PATCH", `/api/projects/${p.id}`, { layer: 1, current_step: 42, current_layer: 1 })).json;
    // Изменилась только вторая
    expect([patched.layers[0].current_step, patched.layers[1].current_step, patched.current_layer]).toEqual([1, 42, 1]);
    // Нити 3 нет
    expect((await call("PATCH", `/api/projects/${p.id}`, { layer: 2, current_step: 1 })).status).toBe(422);
    // Слою можно меньше 1000 линий
    expect((await call("PATCH", `/api/projects/${p.id}`, { layer: 1, line_count: 300 })).json.layers[1].line_count).toBe(300);
    // Шаги второй нити
    expect((await call("GET", `/api/projects/${p.id}/steps?layer=1&limit=1`)).json.total).toBe(300);
    // Кривая второй нити — от 100
    expect((await call("GET", `/api/projects/${p.id}/similarity?layer=1`)).json.curve[0].lines).toBe(100);
    // Нет такой нити
    expect((await call("GET", `/api/projects/${p.id}/similarity?layer=3`)).status).toBe(422);
  // Время на тест — до 2 минут
  }, 120_000);

  // Ошибки создания
  it("ошибки создания: нет фото, лицо, неизвестная доска, лишнее поле", async () => {
    // Фото
    const img = await upload("/api/images", PHOTO);
    // Нет такого фото
    expect((await call("POST", "/api/projects/from-image", { image_id: "000000000000" })).status).toBe(404);
    // «Выделить лицо» в телефоне нельзя
    expect((await call("POST", "/api/projects/from-image", { image_id: img.json.id, prep: { face_focus: true } })).json.detail).toContain("Выделить лицо");
    // Неизвестная доска
    expect((await call("POST", "/api/projects/from-image", { image_id: img.json.id, mode: "bw", board: "pink" })).status).toBe(422);
    // Неизвестный режим
    expect((await call("POST", "/api/projects/from-image", { image_id: img.json.id, mode: "rainbow" })).status).toBe(422);
    // Лишнее поле
    expect((await call("POST", "/api/projects/from-image", { image_id: img.json.id, extra: 1 })).status).toBe(422);
    // Зум вне пределов
    expect((await call("POST", "/api/projects/from-image", { image_id: img.json.id, prep: { zoom: 9 } })).status).toBe(422);
    // «Убрать фон» без маски
    expect((await call("POST", "/api/projects/from-image", { image_id: img.json.id, prep: { remove_background: true } })).status).toBe(503);
    // Состояние маски — фон в телефоне не убрать
    expect((await call("POST", `/api/images/${img.json.id}/mask`)).json.detail).toContain("фон не убирается");
    // Не картинка
    expect((await upload("/api/images", new TextEncoder().encode("hello"), "x.txt")).status).toBe(400);
    // Пустой файл
    expect((await upload("/api/images", new Uint8Array(), "x.jpg")).status).toBe(400);
  });

  // Маска кистью и «Изменить фото»
  it("маска кистью, «Изменить фото» сохраняет режим", async () => {
    // Фото
    const img = await upload("/api/images", PHOTO);
    // Портрет
    const p = (await call("POST", "/api/projects/from-image", { image_id: img.json.id })).json;
    // Маска: левая половина — человек
    const m = new Uint8Array(400 * 400 * 4);
    // Каждая точка
    for (let i = 0; i < 400 * 400; i++) m.fill(i % 400 < 200 ? 255 : 0, i * 4, i * 4 + 4);
    // Сохраняем маску
    const put = await server.handle(new Request(`http://local/api/images/${img.json.id}/mask.png`, { method: "PUT", body: rawImage(m, 400, 400) as BodyInit }));
    // Готова, поправлена кистью
    expect(await put.json()).toMatchObject({ status: "ready", edited: true });
    // Не картинка — 400
    expect((await server.handle(new Request(`http://local/api/images/${img.json.id}/mask.png`, { method: "PUT", body: "oops" }))).status).toBe(400);
    // Теперь «Убрать фон» работает
    const upd = await call("PUT", `/api/projects/${p.id}/photo`, { zoom: 1.2, remove_background: true });
    // Пересчитан, прогресс с начала
    expect(upd.json).toMatchObject({ current_step: 1, mode: "mono", prep: { zoom: 1.2, remove_background: true } });
    // Сброс правок кистью — автоматической маски нет, значит снова 503
    expect((await call("DELETE", `/api/images/${img.json.id}/mask/edits`)).status).toBe(503);
  // Время на тест — до 2 минут
  }, 120_000);

  // Автонастройка
  it("автонастройка яркости и контраста", async () => {
    // Фото
    const img = await upload("/api/images", PHOTO);
    // Подбор
    const r = (await call("POST", `/api/images/${img.json.id}/auto-tone`, { diameter_cm: 50 })).json;
    // Шесть вариантов
    expect(r.candidates).toBe(6);
    // Лучше или так же
    expect(r.score_after).toBeGreaterThanOrEqual(r.score_before);
  // Время на тест — до 2 минут
  }, 120_000);
});

// Группа: файл проекта
describe("файл проекта .nitegraf", () => {
  // Сохранить и открыть
  it("экспорт → импорт: новый портрет с тем же прогрессом", async () => {
    // Фото
    const img = await upload("/api/images", PHOTO);
    // Портрет
    const p = (await call("POST", "/api/projects/from-image", { image_id: img.json.id, name: "Мама" })).json;
    // Прогресс
    await call("PATCH", `/api/projects/${p.id}`, { current_step: 99 });
    // Экспорт
    const exp = await call("GET", `/api/projects/${p.id}/export`);
    // Вложение с русским именем
    expect(exp.res.headers.get("Content-Disposition")).toContain("%D0%9C%D0%B0%D0%BC%D0%B0.nitegraf");
    // Формат
    expect(exp.json).toMatchObject({ format: "nitegraf", version: 1, app: "phone", project: { name: "Мама", current_step: 99 } });
    // Импорт
    const imp = await upload("/api/projects/import", new TextEncoder().encode(JSON.stringify(exp.json)), "p.nitegraf");
    // Создан
    expect(imp.status).toBe(201);
    // Новый id и фото, тот же прогресс и схема
    expect([imp.json.id !== p.id, imp.json.image_id !== p.image_id, imp.json.current_step, imp.json.sequence]).toEqual([true, true, 99, p.sequence]);
  // Время на тест — до 2 минут
  }, 120_000);

  // Файл с компьютера (портрет без фото) и ошибки
  it("файл без фото открывается; испорченный — понятная ошибка", async () => {
    // Схема из 1001 гвоздя
    const seq = [0, ...Array.from({ length: 1000 }, (_, i) => ((i + 1) * 17) % 240)];
    // Подготовленное фото
    const src = toB64(rawImage(new Uint8Array(400 * 400 * 4).fill(255), 400, 400));
    // Файл как с компьютера
    const file = { format: "nitegraf", version: 1, app: "1.4.20", project: { name: "Старый", diameter_cm: 40, line_count: 1000, sequence: seq, activity: { "2026-10-27": [120, 30] } }, source_png: src, image: null };
    // Отправить файл
    const send = (data: unknown) => upload("/api/projects/import", new TextEncoder().encode(JSON.stringify(data)), "p.nitegraf");
    // Открылся
    const ok = await send(file);
    // Без фото, тот же учёт времени
    expect([ok.status, ok.json.image_id, ok.json.activity.total_sec]).toEqual([201, null, 120]);
    // Номер гвоздя вне круга
    expect((await send({ ...file, project: { ...file.project, sequence: [0, 999] } })).json.detail).toBe("Файл проекта испорчен: Номер гвоздя вне 0…239 (project.sequence)");
    // Будущая версия
    expect((await send({ ...file, version: 99 })).json.detail).toContain("новой версией программы");
    // Неизвестная доска
    expect((await send({ ...file, project: { ...file.project, board: "rainbow" } })).status).toBe(422);
    // Режим не совпадает с нитями
    expect((await send({ ...file, project: { ...file.project, layers: [{ color: "black", sequence: [0, 120], line_count: 1 }] } })).json.detail).toContain("Режим не совпадает");
    // Лишнее поле
    expect((await send({ ...file, extra: 1 })).json.detail).toContain("(extra)");
    // Испорченный base64
    expect((await send({ ...file, source_png: "@@@" })).json.detail).toContain("испорченные данные");
    // Не картинка
    expect((await send({ ...file, source_png: "aGVsbG8=" })).json.detail).toBe("Подготовленное фото испорчено");
    // Учёт времени
    expect((await send({ ...file, project: { ...file.project, activity: { вчера: [1, 1] } } })).json.detail).toContain("Учёт времени");
    // Мало линий у одной нити
    expect((await send({ ...file, project: { ...file.project, line_count: 500 } })).json.detail).toContain("от 1000");
    // Чужой формат и не JSON — 400
    expect([(await send({ ...file, format: "other" })).status, (await upload("/api/projects/import", new TextEncoder().encode("hello"), "x")).status]).toEqual([400, 400]);
  });
});

// Группа: уборка
describe("уборка", () => {
  // Фото без портрета старше суток удаляется при открытии списка
  it("старые фото без портрета удаляются", async () => {
    // Фото
    const img = await upload("/api/images", PHOTO);
    // Запись
    const row = (await store.getImage(img.json.id))!;
    // «Загружено» два дня назад
    await store.putImage({ ...row, created_at: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    // Список
    await call("GET", "/api/projects");
    // Удалено
    expect(await store.getImage(img.json.id)).toBeNull();
  });
});
