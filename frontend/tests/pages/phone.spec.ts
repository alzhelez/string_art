// PH-01…PH-06: версия для телефона — всё считается и хранится в браузере, без компьютера и сервера

// Проверки, описание тестов, тип страницы
import { expect, test, type Page } from "@playwright/test";
// Чтение скачанного файла
import fs from "node:fs";
// Пути к фикстурам
import path from "node:path";

// Тестовое фото с лицом
const FACE_JPG = path.join(__dirname, "..", "..", "..", "autotests", "fixtures", "face.jpg");

// Любая ошибка страницы — провал теста. Исключение — восстановимое несовпадение гидратации React #418:
// оно бывает и в программе для Windows, когда файлы приходят мгновенно (из кэша), React сам
// перерисовывает страницу, и на работу это не влияет.
test.beforeEach(async ({ page }) => {
  // Ошибки собираем
  const errors: string[] = [];
  // Ошибка JavaScript на странице (кроме #418)
  page.on("pageerror", (e) => void (!e.message.includes("React error #418") && errors.push(`${page.url()} ${e.message.slice(0, 200)}`)));
  // Сохраняем для afterEach
  (page as Page & { __errors?: string[] }).__errors = errors;
});

// После теста ошибок быть не должно
test.afterEach(async ({ page }) => {
  // Ошибок нет
  expect((page as Page & { __errors?: string[] }).__errors ?? []).toEqual([]);
});

// Открыть главную и дождаться запуска «сервера» в браузере
async function openHome(page: Page) {
  // Главная
  await page.goto("./");
  // Пояснение «работает без компьютера» — значит, запуск прошёл
  await expect(page.getByTestId("local-banner")).toBeVisible();
}

// Создать портрет из фото через интерфейс
async function makePortrait(page: Page, name: string, threads?: string) {
  // Главная
  await openHome(page);
  // Фото
  await page.getByTestId("file-input").setInputFiles(FACE_JPG);
  // Редактор
  await expect(page.getByTestId("photo-controls")).toBeVisible();
  // Выбор нитей
  if (threads) await page.getByTestId("thread-picker").getByRole("radio", { name: threads }).click();
  // Название
  await page.getByLabel("Название").fill(name);
  // «Сделать портрет»
  await page.getByRole("button", { name: "Сделать портрет" }).click();
  // Студия
  await expect(page).toHaveURL(/\/project\/\?id=[0-9a-f]{12}$/, { timeout: 90_000 });
}

// Портрет одной нитью целиком в телефоне
test("PH-01 портрет в телефоне: фото → студия → плетение, без PDF", async ({ page }) => {
  // Портрет
  await makePortrait(page, "Телефон");
  // Название
  await expect(page.getByLabel("Название портрета")).toHaveValue("Телефон");
  // Рекомендованное число линий — от 1000 до 5000
  const lines = Number((await page.getByTestId("lines-value").textContent())!.replace(/\D/g, ""));
  // Проверка
  expect(lines).toBeGreaterThanOrEqual(1000);
  // Не больше максимума
  expect(lines).toBeLessThanOrEqual(5000);
  // Кнопки PDF нет
  await expect(page.getByRole("button", { name: /инструкцию PDF/ })).toHaveCount(0);
  // Шаблона тоже
  await expect(page.getByTestId("download-template")).toHaveCount(0);
  // Плетение
  await page.getByRole("link", { name: "Начать плетение" }).click();
  // Экран плетения
  await expect(page).toHaveURL(/\/project\/weave\/\?id=/);
  // Карточка текущего шага: первый шаг — от A1
  await expect(page.getByRole("region", { name: "Текущий шаг" })).toContainText("A1");
  // Шаг вперёд (кнопка в карточке шага)
  await page.getByRole("region", { name: "Текущий шаг" }).getByRole("button", { name: "Вперёд" }).click();
  // Прогресс: шаг 2
  await expect(page.getByRole("progressbar", { name: "Прогресс плетения" })).toHaveAttribute("aria-valuenow", "2");
});

// Подсказки редактора объясняют, чего нет в телефоне
test("PH-02 редактор: лицо и фон — пояснение про программу на компьютере", async ({ page }) => {
  // Главная
  await openHome(page);
  // Фото
  await page.getByTestId("file-input").setInputFiles(FACE_JPG);
  // Пояснение про фон
  await expect(page.getByText("В версии для телефона фон не убирается")).toBeVisible();
  // Пояснение про лицо
  await expect(page.getByText(/В версии для телефона лицо не ищется/)).toBeVisible();
});

// Цветной портрет: нити и подсказка о ходе расчёта
test("PH-03 цветной портрет «Чёрная + белая» в телефоне", async ({ page }) => {
  // Портрет из двух нитей
  await makePortrait(page, "Две нити", "Чёрная + белая");
  // Две нити в списке лески
  await expect(page.getByTestId("layer-threads").getByRole("listitem")).toHaveCount(2);
});

// Портреты сохраняются в браузере между открытиями
test("PH-04 портрет остаётся после перезагрузки и без интернета", async ({ page, context }) => {
  // Портрет
  await makePortrait(page, "Сохранится");
  // Адрес студии
  const url = page.url();
  // Главная
  await openHome(page);
  // Портрет в списке
  await expect(page.getByText("Сохранится")).toBeVisible();
  // Без интернета
  await context.setOffline(true);
  // Перезагрузка
  await page.reload();
  // Запуск прошёл без сети
  await expect(page.getByTestId("local-banner")).toBeVisible();
  // Портрет на месте
  await expect(page.getByText("Сохранится")).toBeVisible();
  // Студия без сети
  await page.goto(url);
  // Название
  await expect(page.getByLabel("Название портрета")).toHaveValue("Сохранится");
  // Снова с интернетом
  await context.setOffline(false);
});

// Перенос файлом
test("PH-05 «Сохранить файл проекта» → «Открыть файл .nitegraf» в телефоне", async ({ page }) => {
  // Портрет
  await makePortrait(page, "Перенос");
  // Скачиваем файл
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-project").click()]);
  // Имя
  expect(download.suggestedFilename()).toBe("Перенос.nitegraf");
  // Путь
  const file = await download.path();
  // Формат — как у программы на компьютере
  expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toMatchObject({ format: "nitegraf", version: 1, app: "phone" });
  // Главная
  await openHome(page);
  // Открываем файл
  await page.getByTestId("import-input").setInputFiles(file);
  // Студия копии
  await expect(page).toHaveURL(/\/project\/\?id=[0-9a-f]{12}$/);
  // Название то же
  await expect(page.getByLabel("Название портрета")).toHaveValue("Перенос");
});

// Сайт ставится как приложение
test("PH-06 манифест приложения и service worker", async ({ page, request }) => {
  // Главная
  await openHome(page);
  // Ссылка на манифест
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  // Адрес сайта
  expect(href).toBe("/string_art/manifest.webmanifest");
  // Манифест
  const manifest = await (await request.get("manifest.webmanifest")).json();
  // Название и значки
  expect([manifest.short_name, manifest.icons.length, manifest.display]).toEqual(["Нитеграф", 2, "standalone"]);
  // Страница под управлением service worker
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  // Номер сборки вписан
  expect(await (await request.get("sw.js")).text()).not.toContain('const BUILD = "dev";');
});
