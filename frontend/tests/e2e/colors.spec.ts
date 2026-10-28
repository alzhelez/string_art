// UI-29, UI-30 и TC-API-32: портреты из нескольких нитей — создание, студия, плетение по нитям, API
// Проверки и описание тестов
import { expect, test } from "@playwright/test";
// fs — читаем фикстуры
import fs from "node:fs";
// Фото с лицом и уникальные названия
import { FACE_JPG, uniqueName } from "./helpers";

// Расчёт нескольких нитей идёт 10–20 с — даём тестам больше времени
test.describe.configure({ timeout: 120_000 });

// Загрузить фото в редактор через API
async function uploadFace(request: import("@playwright/test").APIRequestContext) {
  // Запрос
  const res = await request.post("/api/images", {
    // Форма с фото
    multipart: { file: { name: "face.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(FACE_JPG) } },
  });
  // Описание фото
  return res.json();
}

// Цветной портрет через интерфейс: выбор нитей, превью в цвете, студия с выбором нити
test("UI-29 «Чёрная + белая» на тёмно-синей доске: студия показывает обе нити", async ({ page }) => {
  // Главная
  await page.goto("/");
  // Фото
  await page.getByTestId("file-input").setInputFiles(FACE_JPG);
  // Редактор
  await expect(page.getByTestId("thread-picker")).toBeVisible();
  // Выбор нитей
  const picker = page.getByTestId("thread-picker");
  // «Чёрная + белая»
  await picker.getByRole("radio", { name: "Чёрная + белая" }).click();
  // Доска тёмно-синяя
  await picker.getByRole("radio", { name: "Тёмно-синяя" }).click();
  // Отмечена
  await expect(picker.getByRole("radio", { name: "Тёмно-синяя" })).toHaveAttribute("aria-checked", "true");
  // Название
  await page.getByLabel("Название").fill(uniqueName("Две нити"));
  // «Сделать портрет»
  await page.getByRole("button", { name: "Сделать портрет" }).click();
  // Студия (расчёт двух нитей — до 60 с)
  await expect(page).toHaveURL(/\/project\?id=[0-9a-f]{12}$/, { timeout: 60_000 });
  // Две нити в списке лески
  const threads = page.getByTestId("layer-threads");
  // Белая и чёрная
  await expect(threads.getByRole("listitem")).toHaveCount(2);
  // Подпись под сценой — про доску
  await expect(page.locator(".stage-note")).toContainText("тёмно-синяя");
  // Выбор нити для ползунка
  const tabs = page.getByRole("radiogroup", { name: "Нить" });
  // Вторая нить
  await tabs.getByRole("radio", { name: /^2\. / }).click();
  // Ползунок подписан нитью 2
  await expect(page.getByText(/Линий: нить 2 из 2/)).toBeVisible();
  // Ставим 500 линий второй нити
  await page.locator("#lines").fill("500");
  // Значение
  await expect(page.getByTestId("lines-value")).toHaveText("500");
  // Ждём отложенного сохранения
  await page.waitForTimeout(800);
  // Перезагружаем
  await page.reload();
  // Вторая нить
  await page.getByRole("radiogroup", { name: "Нить" }).getByRole("radio", { name: /^2\. / }).click();
  // Число сохранилось
  await expect(page.getByTestId("lines-value")).toHaveText("500");
});

// Плетение по нитям: переход к следующей нити и возврат с сохранённым шагом
test("UI-30 плетение по нитям: «Дальше: нить 2», прогресс каждой нити свой", async ({ page, request }) => {
  // Фото
  const img = await uploadFace(request);
  // Портрет из красной и чёрной нити
  const res = await request.post("/api/projects/from-image", { data: { image_id: img.id, name: uniqueName("Цвет"), mode: "color", colors: ["red", "black"] } });
  // Создан
  expect(res.status()).toBe(201);
  // Проект
  const p = await res.json();
  // Первая нить короткая — 101 линия, ставим шаг 100
  await request.patch(`/api/projects/${p.id}`, { data: { layer: 0, line_count: 101, current_step: 100 } });
  // Плетение
  await page.goto(`/project/weave?id=${p.id}`);
  // Подпись нити
  await expect(page.getByTestId("weave-layer")).toContainText("Нить 1 из 2");
  // Шаг 100 из 101
  await expect(page.getByTestId("step-counter")).toContainText("Шаг 100 из 101");
  // Последний шаг
  await page.getByRole("button", { name: "Вперёд" }).click();
  // Старт на последнем шаге → через интервал «Готово»
  await page.getByRole("button", { name: "Продолжить" }).click();
  // Кнопка перехода к следующей нити
  const next = page.getByTestId("next-layer");
  // Видна
  await expect(next).toBeVisible({ timeout: 10_000 });
  // Переходим
  await next.click();
  // Вторая нить, с первого шага
  await expect(page.getByTestId("weave-layer")).toContainText("Нить 2 из 2");
  // Шаг 1
  await expect(page.getByTestId("step-counter")).toContainText("Шаг 1 из");
  // Делаем два шага
  await page.getByRole("button", { name: "Вперёд" }).click();
  // Ещё один
  await page.getByRole("button", { name: "Вперёд" }).click();
  // Шаг 3
  await expect(page.getByTestId("step-counter")).toContainText("Шаг 3 из");
  // Ждём сохранения
  await page.waitForTimeout(700);
  // На сервере: текущая нить вторая, её шаг 3
  const saved = await (await request.get(`/api/projects/${p.id}`)).json();
  // Проверка
  expect([saved.current_layer, saved.layers[1].current_step]).toEqual([1, 3]);
  // После перезагрузки продолжаем со второй нити
  await page.reload();
  // Вторая нить
  await expect(page.getByTestId("weave-layer")).toContainText("Нить 2 из 2");
  // Возврат к первой нити кнопкой
  await page.getByRole("radiogroup", { name: "Нить" }).getByRole("radio", { name: /^1\. / }).click();
  // Шаг первой нити — последний (101)
  await expect(page.getByTestId("step-counter")).toContainText("Шаг 101 из 101");
  // Убираем
  await request.delete(`/api/projects/${p.id}`);
});

// API-контракт цветного портрета (тот же кейс есть в pytest, Go, Ruby, Java, C#)
test("TC-API-32 цветной портрет: слои, PATCH слоя, шаги и сходство слоя", async ({ request }) => {
  // Палитра в настройках
  const cfg = await (await request.get("/api/config")).json();
  // Три режима
  expect(cfg.palette.modes).toEqual(["mono", "bw", "color"]);
  // Фото
  const img = await uploadFace(request);
  // «Чёрная + белая»
  const res = await request.post("/api/projects/from-image", { data: { image_id: img.id, mode: "bw" } });
  // Создан
  expect(res.status()).toBe(201);
  // Проект
  const p = await res.json();
  // Две нити на серой доске
  expect([p.mode, p.board.key, p.layers.map((l: { color: string }) => l.color).sort()]).toEqual(["bw", "gray", ["black", "white"]]);
  // Первая нить повторяет основные поля
  expect(p.layers[0].sequence).toEqual(p.sequence);
  // Вторая нить: 300 линий
  const upd = await (await request.patch(`/api/projects/${p.id}`, { data: { layer: 1, line_count: 300 } })).json();
  // Сохранилось
  expect(upd.layers[1].line_count).toBe(300);
  // Шаги второй нити
  const steps = await (await request.get(`/api/projects/${p.id}/steps?layer=1&limit=2`)).json();
  // Всего 300, начало A1
  expect([steps.total, steps.items[0].from_label]).toEqual([300, "A1"]);
  // Кривая сходства второй нити
  const sim = await (await request.get(`/api/projects/${p.id}/similarity?layer=1`)).json();
  // 25 точек
  expect(sim.curve).toHaveLength(25);
  // Нет третьей нити
  expect((await request.patch(`/api/projects/${p.id}`, { data: { layer: 2, line_count: 300 } })).status()).toBe(422);
  // Убираем
  await request.delete(`/api/projects/${p.id}`);
});
