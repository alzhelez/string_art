// PH-01…PH-08: версия для телефона без компьютера — всё считается и хранится в браузере
// Тесты, проверки и тип страницы
import { expect, test, type Page } from "@playwright/test";
// Чтение скачанных файлов
import fs from "node:fs";
// Пути к фикстурам
import path from "node:path";

// Фото с лицом
const FACE = path.join(__dirname, "..", "..", "..", "autotests", "fixtures", "face.jpg");
// Файл проекта, сохранённый программой на компьютере (чёрная + белая, нить 2, шаг 77)
const DESKTOP_FILE = path.join(__dirname, "..", "fixtures", "desktop.nitegraf");

// Ошибки страницы за тест — их быть не должно
let errors: string[] = [];

// Перед каждым тестом — сбор ошибок страницы
test.beforeEach(async ({ page }) => {
  // С нуля
  errors = [];
  // Исключение в коде страницы
  page.on("pageerror", (e) => errors.push(e.message));
});

// Ошибка React #418 (расхождение HTML при восстановлении гидратации) изредка бывает и у программы
// для Windows: это гонка в статической сборке Next.js 16, React сам перерисовывает страницу,
// человек ничего не замечает. Её пропускаем, любые другие ошибки страницы — провал теста.
const KNOWN = /Minified React error #418/;

// После каждого теста — ошибок нет
test.afterEach(() => {
  // Пусто (кроме известной)
  expect(errors.filter((e) => !KNOWN.test(e))).toEqual([]);
});

// Главная после запуска «сервера» в браузере
async function home(page: Page) {
  // Главная
  await page.goto("./");
  // Пояснение версии для телефона — значит, запуск прошёл
  await expect(page.getByTestId("local-banner")).toBeVisible();
}

// Запрос к «серверу» в браузере (через service worker страницы)
async function api<T>(page: Page, url: string): Promise<T> {
  // fetch внутри страницы (адрес — от корня сайта /string_art/)
  return page.evaluate(async (u) => (await fetch(`/string_art/${u}`)).json(), url);
}

// Сделать портрет из фото через интерфейс
async function create(page: Page, mode?: string) {
  // Главная
  await home(page);
  // Фото
  await page.getByTestId("file-input").setInputFiles(FACE);
  // Редактор
  await expect(page.getByTestId("photo-controls")).toBeVisible();
  // Режим нитей
  if (mode) await page.getByTestId("thread-picker").getByRole("radio", { name: mode }).click();
  // «Сделать портрет»
  await page.getByRole("button", { name: "Сделать портрет" }).click();
  // Студия нового портрета
  await expect(page).toHaveURL(/\/project\/\?id=[0-9a-f]{12}$/, { timeout: 90_000 });
  // id
  return page.url().match(/id=([0-9a-f]{12})/)![1];
}

// Портрет считается в телефоне, рекомендация — по кривой сходства, PDF нет
test("PH-01 портрет из фото без компьютера: рекомендация, без PDF", async ({ page }) => {
  // Портрет
  const id = await create(page);
  // Кривая сходства от «сервера» в браузере
  const sim = await api<{ best_lines: number; curve: unknown[] }>(page, `api/projects/${id}/similarity`);
  // 41 точка
  expect(sim.curve).toHaveLength(41);
  // Ползунок стоит на лучшем числе линий
  await expect(page.getByTestId("lines-value")).toHaveText(sim.best_lines.toLocaleString("ru-RU").replace(/\s/g, " "));
  // Кнопки PDF нет
  await expect(page.getByRole("button", { name: /PDF/ })).toHaveCount(0);
  // Шаблона нет
  await expect(page.getByTestId("download-template")).toHaveCount(0);
  // Сохранить файл проекта — есть
  await expect(page.getByTestId("export-project")).toBeVisible();
  // Превью в списке — картинка от «сервера»
  await home(page);
  // Карточка
  await expect(page.getByTestId("project-card")).toHaveCount(1);
});

// Портреты и прогресс хранятся в браузере
test("PH-02 после перезагрузки портрет и шаг плетения на месте", async ({ page }) => {
  // Портрет
  const id = await create(page);
  // Плетение
  await page.goto(`project/weave/?id=${id}`);
  // Счётчик шагов
  await expect(page.getByTestId("step-counter")).toContainText("Шаг 1 из");
  // Два шага вперёд
  await page.getByRole("button", { name: "Вперёд" }).click();
  // Ещё
  await page.getByRole("button", { name: "Вперёд" }).click();
  // Шаг 3
  await expect(page.getByTestId("step-counter")).toContainText("Шаг 3 из");
  // Даём сохраниться
  await page.waitForTimeout(1500);
  // Перезагрузка
  await page.reload();
  // Тот же шаг
  await expect(page.getByTestId("step-counter")).toContainText("Шаг 3 из");
});

// Файл с компьютера открывается в телефоне
test("PH-03 файл .nitegraf с компьютера: обе нити и прогресс", async ({ page }) => {
  // Главная
  await home(page);
  // Открываем файл
  await page.getByTestId("import-input").setInputFiles(DESKTOP_FILE);
  // Студия
  await expect(page).toHaveURL(/\/project\/\?id=[0-9a-f]{12}$/);
  // Название из файла
  await expect(page.getByLabel("Название портрета")).toHaveValue("С компьютера");
  // Две нити
  await expect(page.getByTestId("layer-threads").getByRole("listitem")).toHaveCount(2);
  // Продолжить со второй нити, шаг 77
  await expect(page.getByTestId("start-weaving")).toHaveText("Продолжить: нить 2, шаг 77");
});

// Файл из телефона — тот же формат
test("PH-04 «Сохранить файл проекта» в телефоне", async ({ page }) => {
  // Портрет
  await create(page);
  // Скачиваем
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-project").click()]);
  // Имя — по названию портрета
  expect(download.suggestedFilename()).toMatch(/\.nitegraf$/);
  // Содержимое
  const data = JSON.parse(fs.readFileSync(await download.path(), "utf-8"));
  // Формат, откуда, фото внутри
  expect([data.format, data.app, Boolean(data.image?.original_jpeg), data.project.sequence.length]).toEqual(["nitegraf", "phone", true, 5001]);
});

// Работает без интернета
test("PH-05 без интернета: главная и студия открываются", async ({ page, context }) => {
  // Портрет (заодно всё сохраняется в кэш)
  const id = await create(page);
  // Даём service worker сохранить файлы
  await page.waitForTimeout(2000);
  // Отключаем сеть
  await context.setOffline(true);
  // Главная
  await home(page);
  // Карточка портрета
  await expect(page.getByTestId("project-card")).toHaveCount(1);
  // Студия
  await page.goto(`project/?id=${id}`);
  // Название на месте
  await expect(page.getByLabel("Название портрета")).toBeVisible();
  // Возвращаем сеть
  await context.setOffline(false);
});

// Цветной портрет считается в телефоне
test("PH-06 «Чёрная + белая»: две нити, переключатель нитей", async ({ page }) => {
  // Портрет из двух нитей
  await create(page, "Чёрная + белая");
  // Две нити в списке лески
  await expect(page.getByTestId("layer-threads").getByRole("listitem")).toHaveCount(2);
  // Переключатель нитей
  await expect(page.getByRole("radiogroup", { name: "Нить" })).toBeVisible();
});

// Чего нет без компьютера — понятно объяснено
test("PH-07 редактор: лицо и фон — пояснение про программу на компьютере", async ({ page }) => {
  // Главная
  await home(page);
  // Фото
  await page.getByTestId("file-input").setInputFiles(FACE);
  // Панель
  const controls = page.getByTestId("photo-controls");
  // Пояснения
  await expect(controls).toContainText("В версии для телефона лицо не ищется");
  // Про фон
  await expect(controls).toContainText("В версии для телефона фон не убирается");
});

// Сайт ставится как приложение
test("PH-08 манифест приложения и service worker", async ({ page, request }) => {
  // Главная
  await home(page);
  // Ссылка на манифест — с адресом сайта
  expect(await page.locator('link[rel="manifest"]').getAttribute("href")).toBe("/string_art/manifest.webmanifest");
  // Манифест
  const manifest = await (await request.get("manifest.webmanifest")).json();
  // Название, значки, без адресной строки
  expect([manifest.short_name, manifest.icons.length, manifest.display]).toEqual(["Нитеграф", 2, "standalone"]);
  // Страница под управлением service worker
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  // Номер сборки вписан после сборки
  expect(await (await request.get("sw.js")).text()).not.toContain('const BUILD = "dev";');
});
