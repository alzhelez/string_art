// UI-31 и TC-API-33: перенос портрета файлом «.nitegraf» — сохранить в студии, открыть в списке
// Проверки и описание тестов
import { expect, test } from "@playwright/test";
// fs — читаем скачанный файл
import fs from "node:fs";
// Создание проекта и уникальные названия
import { createProject, uniqueName } from "./helpers";

// Сохранить файл в студии и открыть его на главной — новый портрет с тем же прогрессом
test("UI-31 перенос: «Сохранить файл проекта» → «Открыть файл .nitegraf»", async ({ page, request }) => {
  // Название
  const name = uniqueName("Перенос");
  // Проект на 2000 линий
  const p = await createProject(request, { name, lines: 2000 });
  // Прогресс 345 и своя катушка
  await request.patch(`/api/projects/${p.id}`, { data: { current_step: 345, own_spool_m: 700 } });
  // Студия
  await page.goto(`/project?id=${p.id}`);
  // Нажимаем и ждём скачивания
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-project").click()]);
  // Имя файла — название портрета
  expect(download.suggestedFilename()).toBe(`${name}.nitegraf`);
  // Путь к файлу
  const file = await download.path();
  // Внутри — JSON нашего формата
  expect(JSON.parse(fs.readFileSync(file, "utf-8")).format).toBe("nitegraf");
  // Главная
  await page.goto("/");
  // Открываем файл
  await page.getByTestId("import-input").setInputFiles(file);
  // Попали в студию нового портрета
  await expect(page).toHaveURL(/\/project\?id=[0-9a-f]{12}$/);
  // Это другой портрет
  expect(page.url()).not.toContain(p.id);
  // Кнопка плетения продолжает с шага 345
  await expect(page.getByTestId("start-weaving")).toHaveText("Продолжить с шага 345");
  // Название то же
  await expect(page.getByLabel("Название портрета")).toHaveValue(name);
});

// Испорченный файл — понятная ошибка в списке
test("UI-31b испорченный файл проекта — понятная ошибка", async ({ page }) => {
  // Главная
  await page.goto("/");
  // Файл «как бы проекта», но с неверной схемой
  await page.getByTestId("import-input").setInputFiles({
    // Имя
    name: "плохой.nitegraf",
    // Тип
    mimeType: "application/json",
    // Содержимое
    buffer: Buffer.from(JSON.stringify({ format: "nitegraf", version: 1, project: {}, source_png: "" })),
  });
  // Ошибка видна
  await expect(page.locator(".projects .form-error")).toContainText("Файл проекта испорчен");
});

// API: экспорт и импорт (тот же кейс есть в pytest, Go, Ruby, Java, C#)
test("TC-API-33 экспорт → импорт: новый портрет с тем же прогрессом", async ({ request }) => {
  // Проект
  const p = await createProject(request, { name: uniqueName("API перенос"), lines: 1500 });
  // Прогресс
  await request.patch(`/api/projects/${p.id}`, { data: { current_step: 99 } });
  // Экспорт
  const res = await request.get(`/api/projects/${p.id}/export`);
  // JSON-вложение
  expect(res.headers()["content-disposition"]).toContain(".nitegraf");
  // Импорт
  const imported = await request.post("/api/projects/import", {
    // Форма с файлом
    multipart: { file: { name: "p.nitegraf", mimeType: "application/json", buffer: await res.body() } },
  });
  // Создан
  expect(imported.status()).toBe(201);
  // Новый портрет
  const copy = await imported.json();
  // Другой id, тот же прогресс, та же схема
  expect([copy.id !== p.id, copy.current_step, copy.line_count, copy.sequence]).toEqual([true, 99, 1500, p.sequence]);
  // Не файл проекта → 400
  const bad = await request.post("/api/projects/import", { multipart: { file: { name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("hello") } } });
  // Проверка
  expect(bad.status()).toBe(400);
  // Убираем копию
  await request.delete(`/api/projects/${copy.id}`);
});
