// API-тесты на TypeScript (Playwright APIRequestContext). Идут через прокси Next.js,
// поэтому заодно проверяют, что rewrite /api/* → бэкенд работает.
// Сценарии TC-API-xx совпадают с pytest/Java/Go/Ruby/C# реализациями (см. autotests/TEST_CASES.md).
// Проверки и описание тестов Playwright
import { expect, test } from "@playwright/test";
// fs — читаем фикстуры для загрузки
import fs from "node:fs";
// Константы фронтенда — сверяем их с настройками сервера
import * as C from "../../lib/constants";
// Расчёт лески на фронтенде — сверяем с сервером
import { threadStats } from "../../lib/thread";
// Помощники: создание проекта, пути к фикстурам, тип проекта
import { createProject, FACE_JPG, NOT_IMAGE, PORTRAIT_JPG, PORTRAIT_PNG, type ApiProject } from "./helpers";

// Группа API-тестов
test.describe("API", () => {
  // Проект с ровно 2000 нитями — с ним работают тесты
  let project: ApiProject;
  // Проект в том виде, как его создал сервер
  let created: ApiProject; // как вернул POST — с рекомендованным числом линий

  // Перед каждым тестом —
  test.beforeEach(async ({ request }) => {
    // — создаём проект
    created = await createProject(request, { name: "API-тест" });
    // Дальше тесты рассчитывают на ровно 2000 линий — рекомендация зависит от фото
    // — и ставим 2000 нитей
    project = await (await request.patch(`/api/projects/${created.id}`, { data: { line_count: 2000 } })).json();
  });

  // После каждого теста —
  test.afterEach(async ({ request }) => {
    // — удаляем проект
    await request.delete(`/api/projects/${project.id}`);
  });

  // Сервер жив
  test("TC-API-01 health", async ({ request }) => {
    // Запрос
    const res = await request.get("/api/health");
    // Успех
    expect(res.ok()).toBeTruthy();
    // Тело
    expect(await res.json()).toEqual({ status: "ok" });
  });

  // Настройки сервера совпадают с константами фронтенда
  test("TC-API-02 config совпадает с константами фронтенда (контракт)", async ({ request }) => {
    // Настройки
    const cfg = await (await request.get("/api/config")).json();
    // Секторы
    expect(cfg.sectors).toEqual([...C.SECTORS]);
    // Гвоздей в секторе
    expect(cfg.nails_per_sector).toBe(C.NAILS_PER_SECTOR);
    // Всего гвоздей
    expect(cfg.total_nails).toBe(C.TOTAL_NAILS);
    // Границы числа нитей
    expect(cfg.lines).toEqual({ min: C.MIN_LINES, max: C.MAX_LINES, per_cm: C.LINES_PER_CM });
    // Диаметр:
    expect(cfg.diameter).toEqual({
      // готовые размеры
      presets_cm: [...C.DIAMETER_PRESETS_CM],
      // по умолчанию
      default_cm: C.DEFAULT_DIAMETER_CM,
      // минимум
      min_cm: C.MIN_DIAMETER_CM,
      // максимум
      max_cm: C.MAX_DIAMETER_CM,
    });
    // Леска:
    expect(cfg.thread).toEqual({
      // толщина
      diameter_mm: C.THREAD_DIAMETER_MM,
      // запас
      margin: C.THREAD_MARGIN,
      // катушки
      spools_m: [...C.STANDARD_SPOOLS_M],
      // большая катушка
      big_spool_m: C.BIG_SPOOL_M,
    });
    // Скорость:
    expect(cfg.speed).toEqual({
      // по умолчанию
      default_sec: C.DEFAULT_SPEED_SEC,
      // шаг
      step_sec: C.SPEED_STEP_SEC,
      // минимум
      min_sec: C.MIN_SPEED_SEC,
      // максимум
      max_sec: C.MAX_SPEED_SEC,
    });
  });

  // Создание проекта
  test("TC-API-03 создание проекта", async ({ request }) => {
    // id из 12 шестнадцатеричных символов
    expect(project.id).toMatch(/^[0-9a-f]{12}$/);
    // Название
    expect(project.name).toBe("API-тест");
    // Рекомендация — точка максимального сходства с фото (TC-API-26)
    // Кривая сходства
    const sim = await (await request.get(`/api/projects/${project.id}/similarity`)).json();
    // Сервер выбрал лучшее число нитей
    expect(created.line_count).toBe(sim.best_lines);
    // После изменения — 2000
    expect(project.line_count).toBe(2000);
    // Прогресс с первого шага
    expect(project.current_step).toBe(1);
    // Скорость по умолчанию
    expect(project.speed_sec).toBe(2);
    // Схема на 5000 нитей
    expect(project.sequence).toHaveLength(5001);
    // Начало — A1
    expect(project.sequence[0]).toBe(0);
    // Катушек хватает
    expect(project.stats.spool_m * project.stats.spool_count).toBeGreaterThanOrEqual(project.stats.total_length_m);
  });

  // Фронтенд и сервер считают леску одинаково
  test("TC-API-03b фронтенд считает леску так же, как бэкенд (контракт)", async () => {
    // Считаем на фронтенде
    const local = threadStats(project.sequence, project.line_count, project.diameter_cm);
    // Чистая длина совпадает до 0,1
    expect(local.raw_length_m).toBeCloseTo(project.stats.raw_length_m, 1);
    // С запасом — с допуском на округление
    expect(Math.abs(local.total_length_m - project.stats.total_length_m)).toBeLessThanOrEqual(0.1);
    // Катушка та же
    expect(local.spool_m).toBe(project.stats.spool_m);
    // Количество катушек то же
    expect(local.spool_count).toBe(project.stats.spool_count);
    // Расстояние между гвоздями то же
    expect(local.nail_spacing_mm).toBe(project.stats.nail_spacing_mm);
  });

  // PNG с прозрачностью на 70 см без названия
  test("TC-API-04 имя из файла, PNG с прозрачностью, 70 см", async ({ request }) => {
    // Создаём
    const p = await createProject(request, { file: PORTRAIT_PNG, diameter: 70 });
    // Название — имя файла
    expect(p.name).toBe("portrait");
    // Диаметр
    expect(p.diameter_cm).toBe(70);
    // Кривая сходства
    const sim = await (await request.get(`/api/projects/${p.id}/similarity`)).json();
    // Для 70 см
    expect(sim.diameter_cm).toBe(70);
    // Число нитей выбрано по ней
    expect(p.line_count).toBe(sim.best_lines);
    // Убираем
    await request.delete(`/api/projects/${p.id}`);
  });

  // Таблица неверных загрузок: название, файл, диаметр, статус
  for (const [title, file, diameter, status] of [
    // Не картинка
    ["не картинка", NOT_IMAGE, "50", 400],
    // Слишком маленький диаметр
    ["диаметр меньше 20", PORTRAIT_JPG, "19.9", 422],
    // Слишком большой
    ["диаметр больше 150", PORTRAIT_JPG, "150.1", 422],
  // as const — TypeScript знает точные значения строк таблицы
  ] as const) {
    // Тест на каждую строку таблицы
    test(`TC-API-05 валидация загрузки: ${title}`, async ({ request }) => {
      // Загружаем
      const res = await request.post("/api/projects", {
        // Форма:
        multipart: {
          // файл с «неизвестным» MIME — сервер должен смотреть на содержимое
          file: { name: file.split("/").pop()!, mimeType: "application/octet-stream", buffer: fs.readFileSync(file) },
          // диаметр
          diameter_cm: diameter,
        },
      });
      // Статус как в таблице
      expect(res.status()).toBe(status);
    });
  }

  // В списке нет схемы
  test("TC-API-07 список без sequence", async ({ request }) => {
    // Список
    const list = await (await request.get("/api/projects")).json();
    // Ищем наш проект
    const found = list.find((p: ApiProject) => p.id === project.id);
    // Он есть
    expect(found).toBeTruthy();
    // Схемы нет
    expect(found.sequence).toBeUndefined();
  });

  // Неизвестный проект
  test("TC-API-08 неизвестный проект — 404", async ({ request }) => {
    // → 404
    expect((await request.get("/api/projects/000000000000")).status()).toBe(404);
  });

  // Шаг и скорость
  test("TC-API-09/10 сохранение шага и скорости", async ({ request }) => {
    // Сохраняем шаг 42 и скорость 2,04999
    const res = await request.patch(`/api/projects/${project.id}`, { data: { current_step: 42, speed_sec: 2.04999 } });
    // Успех
    expect(res.ok()).toBeTruthy();
    // Тело
    const body = await res.json();
    // Шаг
    expect(body.current_step).toBe(42);
    // Скорость округлена до 2,0
    expect(body.speed_sec).toBe(2);
  });

  // Неверные изменения
  for (const body of [{ speed_sec: 0.4 }, { current_step: 2001 }, { line_count: 999 }, { name: " " }, { sequence: [] }]) {
    // Тест на каждое
    test(`TC-API-11 PATCH отклоняет ${JSON.stringify(body)}`, async ({ request }) => {
      // → 422
      expect((await request.patch(`/api/projects/${project.id}`, { data: body })).status()).toBe(422);
    });
  }

  // Меньше нитей — прогресс прижимается
  test("TC-API-12 уменьшение линий подтягивает прогресс", async ({ request }) => {
    // Шаг 1900
    await request.patch(`/api/projects/${project.id}`, { data: { current_step: 1900 } });
    // Уменьшаем до 1500
    const body = await (await request.patch(`/api/projects/${project.id}`, { data: { line_count: 1500 } })).json();
    // Шаг 1500
    expect(body.current_step).toBe(1500);
  });

  // Шаги без разрывов
  test("TC-API-14 шаги непрерывны", async ({ request }) => {
    // Первые 100 шагов
    const page = await (await request.get(`/api/projects/${project.id}/steps?offset=0&limit=100`)).json();
    // Начинаем с A1
    expect(page.items[0].from_label).toBe("A1");
    // Для каждого шага —
    for (let i = 1; i < page.items.length; i++) {
      // — начинается там, где закончился предыдущий
      expect(page.items[i].from_nail).toBe(page.items[i - 1].to_nail);
    }
  });

  // PDF-инструкция
  test("TC-API-16 PDF", async ({ request }) => {
    // 1000 нитей
    await request.patch(`/api/projects/${project.id}`, { data: { line_count: 1000 } });
    // Скачиваем
    const res = await request.get(`/api/projects/${project.id}/instructions.pdf`);
    // Тип PDF
    expect(res.headers()["content-type"]).toBe("application/pdf");
    // Байты
    const buf = await res.body();
    // Сигнатура PDF
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    // 2 вводные страницы + 1000 / 200 страниц шагов
    // Считаем страницы прямо в байтах PDF
    expect((buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(7);
  });

  // Удаление
  test("TC-API-17 удаление", async ({ request }) => {
    // Создаём
    const p = await createProject(request);
    // Удаляем — 204
    expect((await request.delete(`/api/projects/${p.id}`)).status()).toBe(204);
    // Больше не найти
    expect((await request.get(`/api/projects/${p.id}`)).status()).toBe(404);
  });

  // Загрузка фото в редактор
  test("TC-API-19 загрузка фото в редактор и поиск лица", async ({ request }) => {
    // Загружаем
    const res = await request.post("/api/images", {
      // Форма с фото
      multipart: { file: { name: "face.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(FACE_JPG) } },
    });
    // 201
    expect(res.status()).toBe(201);
    // Описание
    const img = await res.json();
    // Лицо нашлось
    expect(img.faces.length).toBeGreaterThanOrEqual(1);
    // Готовый кадр «Выделить лицо»
    expect(img.face_prep.face_focus).toBe(true);
    // Исходник
    const orig = await request.get(`/api/images/${img.id}/original.jpg`);
    // JPEG
    expect(orig.headers()["content-type"]).toBe("image/jpeg");
  });

  // Портрет из фото и смена кадра
  test("TC-API-21/23 портрет из фото с кадром и правка фото", async ({ request }) => {
    // Загружаем фото
    const img = await (
      // запрос
      await request.post("/api/images", {
        // форма с файлом
        multipart: { file: { name: "face.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(FACE_JPG) } },
      })
    // разбираем ответ
    ).json();
    // Создаём проект с кадром
    const created = await request.post("/api/projects/from-image", {
      // id, название, параметры
      data: { image_id: img.id, name: "Из редактора", prep: { zoom: 2, center_x: 0.45, center_y: 0.3, contrast: 0.2 } },
    });
    // 201
    expect(created.status()).toBe(201);
    // Проект
    const p: ApiProject = await created.json();
    // Параметры сохранились
    expect(p.prep).toMatchObject({ zoom: 2, center_x: 0.45, contrast: 0.2, face_focus: false });

    // Прошли 99 шагов
    await request.patch(`/api/projects/${p.id}`, { data: { current_step: 99 } });
    // Меняем кадр на «Выделить лицо»
    const updated: ApiProject = await (await request.put(`/api/projects/${p.id}/photo`, { data: img.face_prep })).json();
    // Прогресс сброшен
    expect(updated.current_step).toBe(1);
    // Флажок сохранён
    expect(updated.prep.face_focus).toBe(true);
    // Схема пересчитана
    expect(updated.sequence).not.toEqual(p.sequence);
    // Зум 10 → 422
    expect((await request.put(`/api/projects/${p.id}/photo`, { data: { zoom: 10 } })).status()).toBe(422);
    // Убираем
    await request.delete(`/api/projects/${p.id}`);
  });

  // Кривая сходства
  test("TC-API-26 кривая сходства с фото и рекомендация", async ({ request }) => {
    // Кривая
    const sim = await (await request.get(`/api/projects/${project.id}/similarity`)).json();
    // Числа нитей в точках
    const lines = sim.curve.map((p: { lines: number }) => p.lines);
    // Начало — минимум
    expect(lines[0]).toBe(C.MIN_LINES);
    // Конец — максимум
    expect(lines.at(-1)).toBe(C.MAX_LINES);
    // Точка с лучшим сходством
    const best = sim.curve.reduce((a: { score: number }, b: { score: number }) => (b.score > a.score ? b : a));
    // Совпадает с ответом
    expect(sim.best_lines).toBe(best.lines);
    // Сходство разумное
    expect(sim.best_score).toBeGreaterThan(0.2);
    // Кривая для 30 см
    const small = await (await request.get(`/api/projects/${project.id}/similarity?diameter_cm=30`)).json();
    // Кривая для 100 см
    const big = await (await request.get(`/api/projects/${project.id}/similarity?diameter_cm=100`)).json();
    // На маленьком круге максимум раньше
    expect(small.best_lines).toBeLessThanOrEqual(sim.best_lines);
    // На большом — позже
    expect(big.best_lines).toBeGreaterThanOrEqual(sim.best_lines);
    // 10 см → 422
    expect((await request.get(`/api/projects/${project.id}/similarity?diameter_cm=10`)).status()).toBe(422);
  });

  // Автонастройка
  test("TC-API-27 автонастройка фото", async ({ request }) => {
    // Подбор долгий — даём 90 с
    test.setTimeout(90_000);
    // Загружаем фото
    const img = await (
      // запрос
      await request.post("/api/images", {
        // форма с файлом
        multipart: { file: { name: "face.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(FACE_JPG) } },
      })
    // разбираем ответ
    ).json();
    // Подбор для кадра «Выделить лицо»
    const res = await request.post(`/api/images/${img.id}/auto-tone`, { data: { prep: img.face_prep, diameter_cm: 50 } });
    // 200; при ошибке — текст ответа
    expect(res.status(), await res.text()).toBe(200);
    // Результат
    const t = await res.json();
    // Не хуже исходного
    expect(t.score_after).toBeGreaterThanOrEqual(t.score_before);
    // Яркость не меньше −0,5
    expect(t.brightness).toBeGreaterThanOrEqual(-0.5);
    // И не больше +0,5
    expect(t.brightness).toBeLessThanOrEqual(0.5);
    // 6 вариантов
    expect(t.candidates).toBe(6);
    // 5 см → 422
    expect((await request.post(`/api/images/${img.id}/auto-tone`, { data: { diameter_cm: 5 } })).status()).toBe(422);
  });
});
