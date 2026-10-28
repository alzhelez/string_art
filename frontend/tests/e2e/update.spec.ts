// UI-32 и TC-API-34: обновление программы для Windows в одну кнопку
// Проверки и описание тестов
import { expect, test } from "@playwright/test";

// Кнопка «Обновить»: ход скачивания с полосой, затем установка (сервер подменён — в браузере обновляться нечему)
test("UI-32 «Обновить»: скачивание с полосой и установка с перезапуском", async ({ page, request }) => {
  // Настоящие настройки
  const config = await (await request.get("/api/config")).json();
  // Подменяем: программа 1.4.10, умеет обновляться сама
  await page.route("**/api/config", (route) => route.fulfill({ json: { ...config, app: { version: "1.4.10", desktop: true, update: true } } }));
  // Подменяем GitHub: вышла 1.4.20
  await page.route("https://api.github.com/**", (route) =>
    // Ответ
    route.fulfill({
      // Релиз с установщиком
      json: {
        // Название релиза
        name: "Нитеграф для Windows 1.4.20",
        // Установщик
        assets: [{ name: "Nitegraf-Setup.exe", browser_download_url: "https://github.com/alzhelez/string_art/releases/download/desktop-latest/Nitegraf-Setup.exe" }],
      },
    }),
  );
  // Ответы опроса по очереди: половина, установка
  const polls = [
    // Скачано 40 из 80 МБ
    { state: "downloading", version: "1.4.20", done: 40 * 1048576, total: 80 * 1048576, error: null, supported: true },
    // Установка
    { state: "installing", version: "1.4.20", done: 80 * 1048576, total: 80 * 1048576, error: null, supported: true },
  ];
  // Сколько раз нажали «Обновить»
  let starts = 0;
  // Подменяем сервер обновления
  await page.route("**/api/update", (route) => {
    // Старт
    if (route.request().method() === "POST") {
      // Считаем
      starts += 1;
      // «Проверяем релиз»
      return route.fulfill({ status: 202, json: { state: "checking", version: null, done: 0, total: 0, error: null, supported: true } });
    }
    // Опрос: следующий ответ (последний повторяется)
    return route.fulfill({ json: polls.length > 1 ? polls.shift() : polls[0] });
  });
  // Главная
  await page.goto("/");
  // Плашка
  const notice = page.getByTestId("update-notice");
  // Новая версия
  await expect(notice).toContainText("1.4.20");
  // Нажимаем «Обновить»
  await notice.getByTestId("update-now").click();
  // Ход скачивания: проценты и мегабайты
  await expect(page.getByTestId("update-progress")).toContainText("50 % (40,0 из 80,0 МБ)");
  // Полоса скачивания
  await expect(notice.getByRole("progressbar", { name: "Скачано" })).toBeVisible();
  // Затем — установка с перезапуском
  await expect(page.getByTestId("update-progress")).toContainText("закроется и через полминуты откроется снова");
  // Кнопок нет — второй раз не нажать
  await expect(notice.getByRole("button")).toHaveCount(0);
  // Старт был один
  expect(starts).toBe(1);
  // Снимаем подмены
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

// API: в веб-версии обновление в одну кнопку недоступно (тот же кейс есть в pytest, Go, Ruby, Java, C#)
test("TC-API-34 /api/update: в веб-версии недоступно", async ({ request }) => {
  // Состояние
  const status = await request.get("/api/update");
  // Ждём, не поддерживается
  expect(await status.json()).toMatchObject({ state: "idle", supported: false });
  // Начать нельзя
  const start = await request.post("/api/update");
  // 404
  expect(start.status()).toBe(404);
  // С пояснением
  expect((await start.json()).detail).toContain("только в программе для Windows");
  // В настройках — «не обновляется»
  expect((await (await request.get("/api/config")).json()).app.update).toBe(false);
});
