// UI-21…28: шаблон разметки, кликер и голос, время и перерывы, катушка, сравнение, открытка и видео, обновление.
// Проверки и описание тестов
import { expect, test } from "@playwright/test";
// fs — читаем скачанные файлы
import fs from "node:fs";
// Помощники: создание проекта, уникальные названия, тип проекта
import { createProject, uniqueName, type ApiProject } from "./helpers";

// Шаблон разметки
test("UI-21 шаблон разметки 1:1 скачивается из студии", async ({ page, request }) => {
  // Проект «Шаблон»
  const p = await createProject(request, { name: "Шаблон" });
  // Открываем студию
  await page.goto(`/project?id=${p.id}`);
  // Нажимаем кнопку и одновременно ждём скачивания
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-template").click()]);
  // Имя файла по-русски
  expect(download.suggestedFilename()).toBe("Шаблон разметки — Шаблон.pdf");
  // Читаем скачанный файл
  const pdf = fs.readFileSync(await download.path());
  // Это PDF
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  // 50 см на A4 — 6 листов + страница с инструкцией
  // Считаем страницы
  expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(7);
});

// Кликер
test("UI-22 кликер/педаль: PageDown, PageUp, B; проверка клавиши во вкладке", async ({ page, request }) => {
  // Проект на 2000 нитей
  const p = await createProject(request, { name: uniqueName("Кликер"), lines: 2000 });
  // Открываем плетение
  await page.goto(`/project/weave?id=${p.id}`);
  // Вкладка «Управление»
  await page.getByRole("tab", { name: /Управление/ }).click();
  // Кликаем по пустому месту
  await page.locator("body").click({ position: { x: 5, y: 5 } }); // фокус со вкладки — на страницу
  // PageDown
  await page.keyboard.press("PageDown");
  // Ещё раз
  await page.keyboard.press("PageDown");
  // Шаг 3
  await expect(page.getByTestId("step-counter")).toContainText("Шаг 3 из");
  // PageUp
  await page.keyboard.press("PageUp");
  // Шаг 2
  await expect(page.getByTestId("step-counter")).toContainText("Шаг 2 из");
  // Проверка клавиш показывает последнюю нажатую
  await expect(page.getByTestId("key-test")).toContainText("PageUp → назад");
  // B
  await page.keyboard.press("b");
  // Пошло воспроизведение
  await expect(page.getByRole("button", { name: "Пауза" }).first()).toBeVisible();
  // Ещё раз B
  await page.keyboard.press("b");
  // Пауза
  await expect(page.getByRole("button", { name: "Продолжить" })).toBeVisible();
});

// Голосовые команды
test("UI-23 голосовые команды (распознавание речи подменено)", async ({ page, request }) => {
  // До загрузки страницы подменяем распознавание речи
  await page.addInitScript(() => {
    // Своё хранилище в window: распознаватель и функция «сказать»
    const w = window as unknown as { __rec?: { onresult: (e: unknown) => void }; __say: (t: string) => void };
    // В новых Chrome есть и SpeechRecognition без префикса — подменяем оба
    // Подделка распознавателя:
    const Fake = class {
      // язык
      lang = "";
      // непрерывно
      continuous = false;
      // промежуточные результаты
      interimResults = false;
      // вариантов
      maxAlternatives = 1;
      // обработчик результата
      onresult = null;
      // обработчик ошибки
      onerror = null;
      // обработчик окончания
      onend = null;
      // При создании —
      constructor() {
        // — запоминаем себя
        w.__rec = this as never;
      }
      // Старт
      start() {}
      // Стоп
      stop() {}
    };
    // Ставим подделку под обоими именами
    Object.assign(window, { SpeechRecognition: Fake, webkitSpeechRecognition: Fake });
    // «Сказать» — отдать распознавателю результат в формате браузера
    w.__say = (text) => w.__rec?.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
  });
  // Проект
  const p = await createProject(request, { name: uniqueName("Голос"), lines: 2000 });
  // Плетение
  await page.goto(`/project/weave?id=${p.id}`);
  // Вкладка «Управление»
  await page.getByRole("tab", { name: /Управление/ }).click();
  // Включаем голос
  await page.getByRole("switch", { name: "Голосовые команды" }).check();
  // Видно «Слушаю…»
  await expect(page.getByText(/Слушаю/)).toBeVisible();
  // Помощник: вызвать «сказать» в странице
  const say = (t: string) => page.evaluate((x) => (window as unknown as { __say: (t: string) => void }).__say(x), t);
  // «Дальше»
  await say("дальше");
  // «Дальше!»
  await say("Дальше!");
  // Шаг 3
  await expect(page.getByTestId("step-counter")).toContainText("Шаг 3 из");
  // «Назад»
  await say("назад");
  // Шаг 2
  await expect(page.getByTestId("step-counter")).toContainText("Шаг 2 из");
  // Длинная фраза
  await say("а потом мы пошли дальше гулять"); // длинная фраза из фильма — не команда
  // Шаг не сменился
  await expect(page.getByTestId("step-counter")).toContainText("Шаг 2 из");
  // Но видно, что услышано
  await expect(page.getByTestId("voice-heard")).toContainText("а потом мы пошли дальше гулять");
});

// Время плетения
test("UI-24 время плетения сохраняется на сервере и даёт прогноз", async ({ page, request }) => {
  // Проект
  const p = await createProject(request, { name: uniqueName("Время"), lines: 2000 });
  // Плетение
  await page.goto(`/project/weave?id=${p.id}`);
  // Прогноз в часах
  await expect(page.getByTestId("eta")).toContainText(/≈ \d+ ч/);
  // Пять шагов вперёд
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Вперёд" }).click();
  // Ждём, пока накопится время
  await page.waitForTimeout(1500);
  // уход со страницы отправляет накопленное
  // Уходим в студию
  await page.getByRole("link", { name: "К настройкам портрета" }).click();
  // Перешли
  await expect(page).toHaveURL(/\/project\?id=/);
  // Учёт на сервере —
  await expect
    // — опрашиваем, пока не появится
    .poll(async () => ((await (await request.get(`/api/projects/${p.id}`)).json()) as ApiProject & { activity: { total_steps: number } }).activity.total_steps)
    // — не меньше 5 шагов
    .toBeGreaterThanOrEqual(5);
  // Снова плетение
  await page.goto(`/project/weave?id=${p.id}`);
  // Вкладка «Время»
  await page.getByRole("tab", { name: /Время/ }).click();
  // Полный прогноз
  await expect(page.getByTestId("eta-full")).toContainText("≈");
  // Перерыв каждые 30 минут
  await page.getByRole("radio", { name: "30 мин" }).click();
  // Перезагружаем
  await page.reload();
  // Вкладка «Время»
  await page.getByRole("tab", { name: /Время/ }).click();
  // Выбор запомнен
  await expect(page.getByRole("radio", { name: "30 мин" })).toHaveAttribute("aria-checked", "true");
});

// Своя катушка
test("UI-25 своя катушка: план смен в студии и подсказка в плетении", async ({ page, request }) => {
  // Проект на 3000 нитей
  const p = await createProject(request, { name: uniqueName("Катушка"), lines: 3000 });
  // Студия
  await page.goto(`/project?id=${p.id}`);
  // Поле длины своей катушки
  const input = page.getByLabel("Длина моей катушки, м");
  // 300 м
  await input.fill("300");
  // Уходим из поля — сохраняется
  await input.blur();
  // Несколько катушек
  await expect(page.getByTestId("spool-plan")).toContainText("Понадобится");
  // Первая смена в списке
  const first = page.getByTestId("spool-planner").getByRole("listitem").first();
  // Её текст
  const text = await first.innerText();
  // Номер шага
  const step = Number(text.match(/После шага ([\d\s ]+)/)![1].replace(/\s/g, ""));
  // Гвоздь узла
  const nail = text.match(/узел на ([ABCD]\d+)/)![1];
  // Сохранено на сервере
  await expect.poll(async () => (await (await request.get(`/api/projects/${p.id}`)).json()).own_spool_m).toBe(300);

  // Ставим прогресс за 5 шагов до смены
  await request.patch(`/api/projects/${p.id}`, { data: { current_step: step - 5 } });
  // Плетение
  await page.goto(`/project/weave?id=${p.id}`);
  // Подсказка «через 5 шагов»
  await expect(page.getByTestId("spool-alert")).toContainText(`Через 5 шагов смена катушки`);
  // И гвоздь узла
  await expect(page.getByTestId("spool-alert")).toContainText(nail);
});

// Сравнение и стена
test("UI-26 сравнение с фото и вид «на стене»", async ({ page, request }) => {
  // Проект
  const p = await createProject(request, { name: uniqueName("Стена") });
  // Студия
  await page.goto(`/project?id=${p.id}`);
  // «Сравнить»
  await page.getByRole("radio", { name: /Сравнить/ }).click();
  // Видно обработанное фото
  await expect(page.getByTestId("compare").getByAltText("Фото после обработки")).toBeVisible();
  // Граница на 20 %
  await page.getByRole("slider", { name: "Граница между фото и нитями" }).fill("20");
  // Фото обрезано справа на 80 %
  await expect(page.getByTestId("compare").getByAltText("Фото после обработки")).toHaveCSS("clip-path", "inset(0px 80% 0px 0px)");
  // «На стене»
  await page.getByRole("radio", { name: /На стене/ }).click();
  // Портрет на стене
  const art = page.getByTestId("wall").locator(".wall-art");
  // Его ширина с 3 м
  const w3 = (await art.boundingBox())!.width;
  // 5 м
  await page.getByRole("radio", { name: "5 м" }).click();
  // Ширина с 5 м
  const w5 = (await art.boundingBox())!.width;
  // С 5 м портрет меньше
  expect(w5).toBeLessThan(w3); // дальше — меньше
  // Подпись
  await expect(page.getByTestId("wall-note")).toContainText("с 5 м");
});

// Открытка и таймлапс
test("UI-27 открытка и видео-таймлапс", async ({ page, request, isMobile }) => {
  // На телефоне не проверяем — долго
  test.skip(isMobile, "запись видео 10 с — проверяем на десктопе");
  // Даём 90 с
  test.setTimeout(90_000);
  // Проект
  const p = await createProject(request, { name: "Открытка" });
  // Студия
  await page.goto(`/project?id=${p.id}`);
  // Подпись открытки
  await page.getByPlaceholder(/например, «Открытка/).fill("Бабушке на юбилей");
  // «Сделать открытку»
  await page.getByTestId("make-card").click();
  // Блок результата
  const card = page.getByTestId("card-result");
  // Картинка готова
  await expect(card.getByRole("img")).toBeVisible();
  // Скачиваем PNG
  const [png] = await Promise.all([page.waitForEvent("download"), card.getByRole("button", { name: /Скачать PNG/ }).click()]);
  // Имя файла
  expect(png.suggestedFilename()).toBe("Открытка.png");
  // Сигнатура PNG
  expect(fs.readFileSync(await png.path()).subarray(1, 4).toString()).toBe("PNG");

  // Видео 10 секунд
  await page.getByRole("radio", { name: "10 с" }).click();
  // «Сделать видео»
  await page.getByTestId("make-video").click();
  // Видно ход записи
  await expect(page.getByTestId("video-progress")).toBeVisible();
  // Блок результата
  const result = page.getByTestId("video-result");
  // Готово за 40 с
  await expect(result).toBeVisible({ timeout: 40_000 });
  // Скачиваем
  const [video] = await Promise.all([page.waitForEvent("download"), result.getByRole("button").click()]);
  // MP4 или WebM — что умеет браузер
  expect(video.suggestedFilename()).toMatch(/^Открытка — таймлапс\.(mp4|webm)$/);
  // Не пустое
  expect(fs.statSync(await video.path()).size).toBeGreaterThan(50_000);
});

// Обновление
test("UI-28 программа для Windows сообщает о новой версии", async ({ page, request }) => {
  // Настоящие настройки
  const config = await (await request.get("/api/config")).json();
  // Подменяем: программа версии 1.4.1
  await page.route("**/api/config", (route) => route.fulfill({ json: { ...config, app: { version: "1.4.1", desktop: true } } }));
  // Подменяем ответ GitHub
  await page.route("https://api.github.com/**", (route) =>
    // Отвечаем
    route.fulfill({
      // JSON:
      json: {
        // название релиза
        name: "Нитеграф для Windows 1.4.9",
        // установщик
        assets: [{ name: "Nitegraf-Setup.exe", browser_download_url: "https://github.com/alzhelez/string_art/releases/download/desktop-latest/Nitegraf-Setup.exe" }],
      },
    }),
  );
  // Главная
  await page.goto("/");
  // Уведомление
  const notice = page.getByTestId("update-notice");
  // Новая версия
  await expect(notice).toContainText("1.4.9");
  // Текущая версия
  await expect(notice).toContainText("у вас 1.4.1");
  // Ссылка на установщик
  await expect(notice.getByRole("link", { name: "Скачать" })).toHaveAttribute("href", /Nitegraf-Setup\.exe$/);
  // «Позже»
  await notice.getByRole("button", { name: "Позже" }).click();
  // Перезагружаем
  await page.reload();
  // Уведомления больше нет
  await expect(page.getByTestId("update-notice")).toHaveCount(0);
  // Снимаем подмены
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
