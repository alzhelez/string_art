// UI-сценарии (Playwright, TypeScript). Запускаются на десктопном и мобильном Chrome.
// Проверки и описание тестов
import { expect, test } from "@playwright/test";
// fs — читаем скачанный PDF
import fs from "node:fs";
// Помощники: создание проекта, фикстуры, шаблон числа, уникальные названия, тип
import { createProject, FACE_JPG, NOT_IMAGE, numRe, PORTRAIT_JPG, uniqueName, type ApiProject } from "./helpers";

// Группа: главная страница и создание портрета
test.describe("Новый портрет", () => {
  // Не картинка
  test("UI-01 не-картинку не принимает", async ({ page }) => {
    // Открываем главную
    await page.goto("/");
    // Выбираем текстовый файл
    await page.getByTestId("file-input").setInputFiles(NOT_IMAGE);
    // Видна ошибка
    await expect(page.locator(".form-error")).toHaveText(/Это не изображение/);
    // Кнопка создания недоступна
    await expect(page.getByRole("button", { name: "Сделать портрет" })).toBeDisabled();
  });

  // Полный путь от фото до студии
  test("UI-02 загрузка фото → студия с расчётом лески", async ({ page }) => {
    // Уникальное название
    const name = uniqueName("Портрет E2E");
    // Главная
    await page.goto("/");
    // Выбираем фото
    await page.getByTestId("file-input").setInputFiles(PORTRAIT_JPG);
    // Появился редактор
    await expect(page.getByTestId("photo-controls")).toBeVisible();
    // Вводим название
    await page.getByLabel("Название").fill(name);
    // Диаметр 70
    await page.getByRole("radio", { name: "70" }).click();
    // «Сделать портрет»
    await page.getByRole("button", { name: "Сделать портрет" }).click();

    // Попали в студию
    await expect(page).toHaveURL(/\/project\?id=[0-9a-f]{12}$/);
    // Название на месте
    await expect(page.getByLabel("Название портрета")).toHaveValue(name);
    // Диаметр отмечен
    await expect(page.getByRole("radio", { name: "70" })).toHaveAttribute("aria-checked", "true");
    // Число линий — рекомендация по максимальному сходству с фото
    // id проекта из адреса
    const id = page.url().match(/[?&]id=([0-9a-f]{12})/)![1];
    // Кривая сходства с сервера
    const sim = await (await page.request.get(`/api/projects/${id}/similarity`)).json();
    // Число нитей — лучшее
    await expect(page.getByTestId("lines-value")).toHaveText(numRe(sim.best_lines));
    // Шагов столько же
    await expect(page.getByTestId("stat-steps")).toHaveText(numRe(sim.best_lines));
    // Расстояние между гвоздями для 70 см
    await expect(page.getByTestId("stat-spacing")).toHaveText("9,16 мм");
    // Длина катушки в метрах
    await expect(page.getByTestId("stat-spool")).toHaveText(/\d.* м$/);
    // Схема нарисована с тем же числом нитей
    await expect(page.getByTestId("board")).toHaveAttribute("data-lines", String(sim.best_lines));
    // Объяснение рекомендации
    await expect(page.getByTestId("recommendation")).toContainText("больше всего похожа на фото");
    // Сходство 100 % от лучшего
    await expect(page.getByTestId("similarity-current")).toHaveText(/Сходство с фото: 100,0\s% от лучшего/);
  });
});

// Группа: студия
test.describe("Студия", () => {
  // Ползунок и диаметр
  test("UI-03 ползунок и диаметр меняют расчёт сразу и сохраняются", async ({ page, request }) => {
    // Проект
    const p = await createProject(request, { name: uniqueName("Студия") });
    // Студия
    await page.goto(`/project?id=${p.id}`);
    // Запоминаем расход лески
    const spoolBefore = await page.getByTestId("stat-total").innerText();

    // 4000 нитей
    await page.locator("#lines").fill("4000");
    // Подпись
    await expect(page.getByTestId("lines-value")).toHaveText("4 000");
    // Схема перерисована
    await expect(page.getByTestId("board")).toHaveAttribute("data-lines", "4000");
    // Расход изменился
    await expect(page.getByTestId("stat-total")).not.toHaveText(spoolBefore);

    // Свой диаметр 45,5
    await page.getByLabel("Свой диаметр, см").fill("45,5");
    // Расстояние между гвоздями пересчитано
    await expect(page.getByTestId("stat-spacing")).toHaveText("5,96 мм");

    // Ждём отложенного сохранения
    await page.waitForTimeout(700); // debounce 400 мс
    // Перезагружаем
    await page.reload();
    // Нити сохранились
    await expect(page.getByTestId("lines-value")).toHaveText("4 000");
    // Диаметр сохранился
    await expect(page.getByLabel("Свой диаметр, см")).toHaveValue("45.5");
  });

  // PDF-инструкция
  test("UI-04 скачивание PDF-инструкции", async ({ page, request }) => {
    // Проект
    const p = await createProject(request, { name: "Бабушка PDF" });
    // Студия
    await page.goto(`/project?id=${p.id}`);
    // Одновременно ждём скачивания —
    const [download] = await Promise.all([
      // событие скачивания
      page.waitForEvent("download"),
      // и нажимаем кнопку
      page.getByRole("button", { name: "Скачать инструкцию PDF" }).click(),
    ]);
    // Имя файла по-русски
    expect(download.suggestedFilename()).toBe("Инструкция — Бабушка PDF.pdf");
    // Путь к скачанному
    const file = await download.path();
    // Это PDF
    expect(fs.readFileSync(file).subarray(0, 4).toString()).toBe("%PDF");
  });

  // Удаление
  test("UI-05 удаление портрета", async ({ page, request }) => {
    // Название
    const name = uniqueName("Удалить");
    // Проект
    const p = await createProject(request, { name });
    // Студия
    await page.goto(`/project?id=${p.id}`);
    // Соглашаемся в окне подтверждения
    page.once("dialog", (d) => d.accept());
    // «Удалить портрет»
    await page.getByRole("button", { name: "Удалить портрет" }).click();
    // Вернулись на главную
    await expect(page).toHaveURL(/\/$/);
    // Портрета в списке нет
    await expect(page.getByText(name)).toHaveCount(0);
  });

  // Старые адреса
  test("UI-18 старые адреса /projects/<id> ведут на новые", async ({ page, request }) => {
    // Проект
    const p = await createProject(request, { name: uniqueName("Адрес") });
    // Старый адрес плетения
    await page.goto(`/projects/${p.id}/weave`);
    // Перенаправило на новый
    await expect(page).toHaveURL(new RegExp(`/project/weave\\?id=${p.id}$`));
    // Страница работает
    await expect(page.getByTestId("step-counter")).toBeVisible();
    // Старый адрес студии
    await page.goto(`/projects/${p.id}`);
    // Перенаправило
    await expect(page).toHaveURL(new RegExp(`/project\\?id=${p.id}$`));
  });

  // Несуществующий проект
  test("UI-06 несуществующий проект", async ({ page }) => {
    // Неизвестный id
    await page.goto("/project?id=000000000000");
    // Понятная ошибка
    await expect(page.locator(".form-error")).toHaveText("Проект не найден.");
    // Без id
    await page.goto("/project");
    // Та же ошибка
    await expect(page.locator(".form-error")).toHaveText("Проект не найден.");
  });
});

// Группа: плетение
test.describe("Плетение", () => {
  // Автоперелистывание
  test("UI-07 автоперелистывание, скорость и сохранение шага после перезагрузки", async ({ page, request }) => {
    // Проект на 2000 нитей
    const p = await createProject(request, { name: uniqueName("Плетение"), lines: 2000 });
    // Плетение
    await page.goto(`/project/weave?id=${p.id}`);
    // Первый шаг
    await expect(page.getByTestId("step-counter")).toHaveText(/Шаг 1 из 2\s000/);
    // Скорость по умолчанию
    await expect(page.getByTestId("speed")).toHaveText("2,0 с на шаг");

    // Быстрее
    await page.getByRole("button", { name: /Быстрее/ }).click();
    // Ещё быстрее
    await page.getByRole("button", { name: /Быстрее/ }).click();
    // 1,8
    await expect(page.getByTestId("speed")).toHaveText("1,8 с на шаг");
    // Медленнее
    await page.getByRole("button", { name: /Медленнее/ }).click();
    // 1,9
    await expect(page.getByTestId("speed")).toHaveText("1,9 с на шаг");

    // Старт
    await page.getByRole("button", { name: "Старт" }).click();
    // Через пару интервалов — шаг 3
    await expect(page.getByTestId("step-counter")).toHaveText(/Шаг 3 из/, { timeout: 6000 });
    // Пауза
    await page.getByRole("button", { name: "Пауза" }).click();
    // Запоминаем шаг
    const step = (await page.getByTestId("step-counter").innerText()).match(/Шаг (\d+)/)![1];

    // Ждём сохранения
    await page.waitForTimeout(600);
    // Перезагружаем
    await page.reload();
    // Тот же шаг
    await expect(page.getByTestId("step-counter")).toHaveText(new RegExp(`Шаг ${step} из`));
    // Та же скорость
    await expect(page.getByTestId("speed")).toHaveText("1,9 с на шаг");
    // Кнопка «Продолжить»
    await expect(page.getByRole("button", { name: "Продолжить" })).toBeVisible();

    // текущий шаг совпадает с тем, что отдаёт API
    // Шаг из API
    const steps = await (await request.get(`/api/projects/${p.id}/steps?offset=${Number(step) - 1}&limit=1`)).json();
    // На экране тот же
    await expect(page.getByTestId("current-step")).toHaveText(`${steps.items[0].from_label} → ${steps.items[0].to_label}`);
  });

  // Озвучка
  test("UI-08 озвучка шага (Web Speech API подменён)", async ({ page, request }) => {
    // До загрузки страницы подменяем синтез речи
    await page.addInitScript(() => {
      // Список произнесённого
      const w = window as unknown as { __spoken: string[] };
      // Пока пустой
      w.__spoken = [];
      // Подменяем синтезатор:
      Object.defineProperty(window, "speechSynthesis", {
        // отмена, голоса, произнесение
        value: { cancel() {}, getVoices: () => [], speak: (u: { text: string }) => w.__spoken.push(u.text) },
      });
      // Подменяем класс фразы:
      (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
        // язык
        lang = "";
        // скорость
        rate = 1;
        // голос
        voice = null;
        // текст
        constructor(public text: string) {}
      };
    });
    // Проект
    const p = await createProject(request);
    // Плетение
    await page.goto(`/project/weave?id=${p.id}`);
    // Вкладка «Сигнал шага»
    await page.getByRole("tab", { name: /Сигнал шага/ }).click();
    // «Голос»
    await page.getByRole("radio", { name: "Голос" }).click();
    // Появился выбор, что озвучивать
    await expect(page.getByLabel("Что озвучивать")).toBeVisible();
    // «Вперёд»
    await page.getByRole("button", { name: "Вперёд" }).click();
    // Читаем произнесённое
    const spoken = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
    // Минимум две фразы
    expect(spoken.length).toBeGreaterThanOrEqual(2);
    // Последняя — подпись гвоздя по-русски
    expect(spoken.at(-1)).toMatch(/^(А|Бэ|Цэ|Дэ) \d{1,2}$/);
  });

  // Прогресс в списке
  test("UI-09 прогресс виден в списке портретов", async ({ page, request }) => {
    // Название
    const name = uniqueName("Прогресс");
    // Проект
    const p = await createProject(request, { name, lines: 2000 });
    // Шаг 150
    await request.patch(`/api/projects/${p.id}`, { data: { current_step: 150 } });
    // Главная
    await page.goto("/");
    // Карточка проекта
    const card = page.getByTestId("project-card").filter({ hasText: name });
    // Видно «Шаг 150 из 2 000»
    await expect(card).toContainText("Шаг 150 из 2 000");
    // Открываем
    await card.click();
    // Кнопка продолжения с шага 150
    await expect(page.getByTestId("start-weaving")).toHaveText("Продолжить с шага 150");
  });
});

// Группа: редактор фото
test.describe("Редактор фото", () => {
  // id проекта из адреса
  const projectIdFromUrl = (url: string) => url.match(/[?&]id=([0-9a-f]{12})/)![1];

  // Кадр, яркость и «Выделить лицо»
  test("UI-10 кадр, яркость и «Выделить лицо» попадают в расчёт", async ({ page, request, isMobile }) => {
    // Главная
    await page.goto("/");
    // Фото с лицом
    await page.getByTestId("file-input").setInputFiles(FACE_JPG);
    // Редактор
    await expect(page.getByTestId("photo-controls")).toBeVisible();
    // Кадр двигаем, когда фото уже на холсте (на медленном CI оно грузится не сразу)
    // Ждём, пока фото загрузится
    await expect(page.getByText("Загружаем фото…")).toBeHidden({ timeout: 30_000 });
    // Ползунок масштаба
    const zoom = page.getByRole("slider", { name: "Масштаб" });
    // Сначала 1
    await expect(zoom).toHaveValue("1");

    // «Выделить лицо»
    await page.getByLabel("Выделить лицо").check();
    // Зум вырос
    expect(Number(await zoom.inputValue())).toBeGreaterThan(1.5);

    // Яркость 0,1
    await page.getByRole("slider", { name: "Яркость" }).fill("0.1");
    // На телефоне —
    if (isMobile) {
      // Эмуляция тача в Playwright не умеет «тянуть» — проверяем сдвиг с клавиатуры (тоже часть доступности)
      // фокус в окно кадра
      await page.getByTestId("photo-viewport").focus();
      // стрелка влево
      await page.keyboard.press("ArrowLeft");
      // ещё раз
      await page.keyboard.press("ArrowLeft");
    // На компьютере —
    } else {
      // Сдвиг кадра мышью (после ползунков страница могла прокрутиться — возвращаем кадр в окно)
      // прокручиваем к окну
      await page.getByTestId("photo-viewport").scrollIntoViewIfNeeded();
      // его положение
      const box = (await page.getByTestId("photo-viewport").boundingBox())!;
      // мышь в центр
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      // нажали
      await page.mouse.down();
      // тянем вправо на 40 px
      await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
      // отпустили
      await page.mouse.up();
    }

    // Название
    await page.getByLabel("Название").fill(uniqueName("Лицо"));
    // «Сделать портрет»
    await page.getByRole("button", { name: "Сделать портрет" }).click();
    // Студия
    await expect(page).toHaveURL(/\/project\?id=[0-9a-f]{12}$/, { timeout: 30_000 });

    // Проект с сервера
    const p: ApiProject = await (await request.get(`/api/projects/${projectIdFromUrl(page.url())}`)).json();
    // Лицо выделено
    expect(p.prep.face_focus).toBe(true);
    // Яркость
    expect(p.prep.brightness).toBeCloseTo(0.1, 5);
    // Зум
    expect(p.prep.zoom).toBeGreaterThan(1.5);
    // Описание картинки
    const img = await (await request.get(`/api/images/${p.image_id}`)).json();
    // Центр кадра левее, чем у «лица»
    expect(p.prep.center_x).toBeLessThan(img.face_prep.center_x); // сдвинули фото вправо → центр кадра левее лица
  });

  // Удаление фона
  test("UI-11 «Убрать фон»", async ({ page, request }) => {
    // Возможности сервера
    const features = (await (await request.get("/api/config")).json()).features;
    // Без rembg — пропуск
    test.skip(!features.background_removal, "на сервере не установлен rembg");
    // Модель может скачиваться
    test.setTimeout(240_000); // при самом первом запуске скачивается модель
    // Главная
    await page.goto("/");
    // Фото
    await page.getByTestId("file-input").setInputFiles(FACE_JPG);
    // «Убрать фон»
    await page.getByLabel("Убрать фон").check();
    // Маска готова
    await expect(page.getByText("Фон станет белым")).toBeVisible({ timeout: 200_000 });
    // «Сделать портрет»
    await page.getByRole("button", { name: "Сделать портрет" }).click();
    // Студия
    await expect(page).toHaveURL(/\/project\?id=[0-9a-f]{12}$/, { timeout: 30_000 });
    // Проект
    const p: ApiProject = await (await request.get(`/api/projects/${projectIdFromUrl(page.url())}`)).json();
    // Флажок сохранён
    expect(p.prep.remove_background).toBe(true);
  });

  // Кисть
  test("UI-17 кисть: стереть лишнее, отменить, правка уходит в расчёт", async ({ page, request, isMobile }) => {
    // Возможности сервера
    const features = (await (await request.get("/api/config")).json()).features;
    // Без rembg — пропуск
    test.skip(!features.background_removal, "на сервере не установлен rembg");
    // На телефоне — пропуск
    test.skip(isMobile, "мазок мышью — на десктопе; тач-жесты проверены вручную");
    // Модель может скачиваться
    test.setTimeout(240_000);
    // Главная
    await page.goto("/");
    // Фото
    await page.getByTestId("file-input").setInputFiles(FACE_JPG);
    // «Убрать фон»
    await page.getByLabel("Убрать фон").check();
    // Панель кисти
    const panel = page.getByTestId("brush-panel");
    // Появилась
    await expect(panel).toBeVisible({ timeout: 200_000 });
    // Отменять нечего
    await expect(panel.getByRole("button", { name: "Отменить" })).toBeDisabled();
    // Режим «Стереть»
    await panel.getByRole("radio", { name: "Стереть" }).click();
    // Окно кадра в режиме стирания
    await expect(page.getByTestId("photo-viewport")).toHaveAttribute("data-tool", "erase");

    // Фото загружено
    await expect(page.getByText("Загружаем фото…")).toBeHidden({ timeout: 30_000 });
    // Окно кадра
    const viewport = page.getByTestId("photo-viewport");
    // Прокручиваем к нему
    await viewport.scrollIntoViewIfNeeded();
    // Его положение
    const box = (await viewport.boundingBox())!;
    // Помощник: мазок по горизонтали на высоте y
    const stroke = async (y: number) => {
      // в точку 30 % ширины
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * y);
      // нажали
      await page.mouse.down();
      // тянем до 70 %
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * y, { steps: 8 });
      // отпустили
      await page.mouse.up();
    };
    // Ждём сохранения маски на сервер
    const put = page.waitForResponse((r) => r.url().includes("/mask.png") && r.request().method() === "PUT");
    // Первый мазок
    await stroke(0.5);
    // Второй
    await stroke(0.6);
    // Сохранение прошло
    expect((await put).status()).toBe(200);
    // «Отменить»
    await panel.getByRole("button", { name: "Отменить" }).click(); // второй мазок отменён
    // Первый мазок ещё можно отменить
    await expect(panel.getByRole("button", { name: "Отменить" })).toBeEnabled();

    // «Сделать портрет»
    await page.getByRole("button", { name: "Сделать портрет" }).click();
    // Студия
    await expect(page).toHaveURL(/\/project\?id=[0-9a-f]{12}$/, { timeout: 60_000 });
    // Проект
    const p: ApiProject = await (await request.get(`/api/projects/${projectIdFromUrl(page.url())}`)).json();
    // Фон убран
    expect(p.prep.remove_background).toBe(true);
    // Маска с правками
    expect((await (await request.get(`/api/images/${p.image_id}/mask`)).json()).edited).toBe(true);
    // как правка влияет на пиксели кадра, проверяет pytest (TC-API-28); здесь — что маска отдаётся
    // Маска
    const mask = await request.get(`/api/images/${p.image_id}/mask.png`);
    // Отдаётся
    expect(mask.ok()).toBeTruthy();
  });

  // Правка фото готового портрета
  test("UI-12 правка фото готового портрета пересчитывает схему и сбрасывает прогресс", async ({ page, request }) => {
    // Проект из фото
    const p = await createProject(request, { name: uniqueName("Правка"), file: FACE_JPG });
    // Пройдено 321 шаг
    await request.patch(`/api/projects/${p.id}`, { data: { current_step: 321 } });
    // Студия
    await page.goto(`/project?id=${p.id}`);
    // «Изменить фото»
    await page.getByTestId("edit-photo").click();
    // Редактор этого проекта
    await expect(page).toHaveURL(new RegExp(`/project/photo\\?id=${p.id}$`));
    // Предупреждение про потерю 321 шага
    await expect(page.getByTestId("progress-warning")).toContainText("321");
    // Зум 2
    await page.getByRole("slider", { name: "Масштаб" }).fill("2");
    // «Пересчитать портрет»
    await page.getByRole("button", { name: "Пересчитать портрет" }).click();
    // Студия
    await expect(page).toHaveURL(new RegExp(`/project\\?id=${p.id}$`), { timeout: 30_000 });
    // Прогресс сброшен
    await expect(page.getByTestId("start-weaving")).toHaveText("Начать плетение");
    // Проект
    const after: ApiProject = await (await request.get(`/api/projects/${p.id}`)).json();
    // Новый зум
    expect(after.prep.zoom).toBe(2);
    // Новая схема
    expect(after.sequence).not.toEqual(p.sequence);
  });
});

// Группа: сходство, автонастройка, медиа, тема
test.describe("Сходство, автонастройка, медиа, тема", () => {
  // Кнопка «Поставить»
  test("UI-13 рекомендация по сходству и кнопка «Поставить»", async ({ page, request }) => {
    // Проект на 1000 нитей
    const p = await createProject(request, { name: uniqueName("Сходство"), lines: 1000 });
    // Кривая
    const sim = await (await request.get(`/api/projects/${p.id}/similarity`)).json();
    // Если лучшее и есть 1000 — проверять нечего
    test.skip(sim.best_lines === 1000, "рекомендация совпала с выставленным значением");
    // Студия
    await page.goto(`/project?id=${p.id}`);
    // 1000
    await expect(page.getByTestId("lines-value")).toHaveText(numRe(1000));
    // Кнопка «Поставить …»
    const set = page.getByRole("button", { name: /^Поставить / });
    // Видна
    await expect(set).toBeVisible();
    // Нажимаем
    await set.click();
    // Лучшее число
    await expect(page.getByTestId("lines-value")).toHaveText(numRe(sim.best_lines));
    // Кнопка исчезла
    await expect(set).toHaveCount(0);
    // Ждём отложенного сохранения на сервер
    await page.waitForTimeout(700); // debounce
    // Проект
    const after: ApiProject = await (await request.get(`/api/projects/${p.id}`)).json();
    // Сохранено
    expect(after.line_count).toBe(sim.best_lines);
  });

  // Автонастройка
  test("UI-14 автонастройка фото подбирает яркость и контраст", async ({ page }) => {
    // Подбор долгий
    test.setTimeout(120_000);
    // Главная
    await page.goto("/");
    // Фото
    await page.getByTestId("file-input").setInputFiles(FACE_JPG);
    // Редактор
    await expect(page.getByTestId("photo-controls")).toBeVisible();
    // «Автонастройка»
    await page.getByRole("button", { name: "Автонастройка" }).click();
    // Результат
    const result = page.getByTestId("auto-result");
    // Появился
    await expect(result).toBeVisible({ timeout: 100_000 });
    // Про сходство
    await expect(result).toContainText(/сходство/i);
    // лицо найдено → автонастройка заодно выделила его
    // Лицо выделено
    await expect(page.getByLabel("Выделить лицо")).toBeChecked();
    // Зум вырос
    expect(Number(await page.getByRole("slider", { name: "Масштаб" }).inputValue())).toBeGreaterThan(1.5);
  });

  // Своя музыка
  test("UI-15 своя музыка во время плетения и пауза вместе с плетением", async ({ page, request }) => {
    // Проект
    const p = await createProject(request, { name: uniqueName("Музыка") });
    // Плетение
    await page.goto(`/project/weave?id=${p.id}`);
    // Панель видео
    const panel = page.getByTestId("media-panel");
    // Выбираем WAV
    await panel.getByTestId("media-file-input").setInputFiles({ name: "Тишина.wav", mimeType: "audio/wav", buffer: silentWav(3) });
    // Плеер на сцене
    const audio = page.getByTestId("media-screen").getByTestId("media-element");
    // В документе
    await expect(audio).toBeAttached();
    // В плейлисте
    await expect(panel.getByRole("list", { name: "Плейлист" })).toContainText("Тишина");
    // Помощник: на паузе ли плеер
    const paused = () => audio.evaluate((el: HTMLMediaElement) => el.paused);

    // Старт
    await page.getByRole("button", { name: "Старт" }).click();
    // Играет
    await expect.poll(paused).toBe(false);
    // Пауза
    await page.getByRole("button", { name: "Пауза" }).click();
    // На паузе
    await expect.poll(paused).toBe(true);

    // ссылки запоминаются между заходами
    // Ссылка YouTube
    await panel.getByLabel("Ссылка или код <iframe …>").fill("https://youtu.be/dQw4w9WgXcQ");
    // «Добавить»
    await panel.getByRole("button", { name: "Добавить" }).click();
    // Два пункта
    await expect(panel.getByRole("listitem")).toHaveCount(2);
    // Перезагружаем
    await page.reload();
    // Файл не сохраняется, ссылка — да
    await expect(page.getByTestId("media-panel").getByRole("listitem")).toHaveCount(1);
    // Плеер YouTube
    await expect(page.getByTestId("media-screen").locator("iframe")).toHaveAttribute("src", /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  });

  // Кино
  test("UI-19 фильм, шаг и схема видны одновременно; кино на весь экран с шагом", async ({ page, request, isMobile }) => {
    // Размер ноутбука
    if (!isMobile) await page.setViewportSize({ width: 1366, height: 768 }); // обычный ноутбук
    // Проект
    const p = await createProject(request, { name: uniqueName("Кино") });
    // Плетение
    await page.goto(`/project/weave?id=${p.id}`);
    // Видео-файл
    await page.getByTestId("media-file-input").setInputFiles({ name: "Фильм.webm", mimeType: "video/webm", buffer: Buffer.from("x") });
    // Наверх
    await page.evaluate(() => window.scrollTo(0, 0));
    // Сцена с видео
    const film = page.getByTestId("media-screen");
    // Видна
    await expect(film).toBeVisible();
    // без прокрутки: видео, «откуда → куда» и кнопка старта на экране
    // Шаг на экране
    await expect(page.getByTestId("current-step")).toBeInViewport();
    // Кнопка старта
    await expect(page.getByRole("button", { name: "Старт" })).toBeInViewport();
    // Видео почти целиком
    await expect(film).toBeInViewport({ ratio: isMobile ? 0.6 : 0.9 });
    // Схема на компьютере
    if (!isMobile) await expect(page.getByTestId("board")).toBeInViewport({ ratio: 0.6 });

    // «Кино»
    await page.getByTestId("cinema-toggle").click();
    // Поверх видео
    const hud = page.getByTestId("cinema-hud");
    // Видна
    await expect(hud).toBeVisible();
    // Тот же шаг
    await expect(hud).toContainText(await page.getByTestId("current-step").innerText());
    // «Вперёд»
    await hud.getByRole("button", { name: "Вперёд" }).click();
    // Шаг 2
    await expect(page.getByTestId("step-counter")).toContainText("Шаг 2");
    // «Выйти из кино»
    await hud.getByRole("button", { name: "Выйти из кино" }).click();
    // Подсказки нет
    await expect(hud).toHaveCount(0);
  });

  // Яндекс Музыка и VK Видео
  test("UI-20 музыка — отдельная графа: код Яндекс Музыки и VK Видео", async ({ page, request }) => {
    // Проект
    const p = await createProject(request, { name: uniqueName("Музыка") });
    // Плетение
    await page.goto(`/project/weave?id=${p.id}`);
    // Блок музыки
    const dock = page.getByTestId("music-dock");
    // Вставляем код Яндекс Музыки
    await dock.getByLabel("Код Яндекс Музыки или ссылка").fill(
      // Код
      '<iframe frameborder="0" allow="clipboard-write" style="border:none;width:614px;height:556px;" width="614" height="556" src="https://music.yandex.ru/iframe/playlist/alzhelez2018/3">Слушайте <a href="https://music.yandex.ru/playlists/lk.1">Мне нравится</a> — <a href="https://music.yandex.ru/users/alzhelez2018">Alzhelez21</a> на Яндекс Музыке</iframe>',
    );
    // «Добавить»
    await dock.getByRole("button", { name: "Добавить" }).click();
    // Виджет
    await expect(dock.getByTestId("music-frame")).toHaveAttribute("src", "https://music.yandex.ru/iframe/playlist/alzhelez2018/3");
    // Название
    await expect(dock).toContainText("Мне нравится — Alzhelez21");

    // Панель видео
    const panel = page.getByTestId("media-panel");
    // Вставляем код VK
    await panel.getByLabel("Ссылка или код <iframe …>").fill(
      // Код
      '<iframe src="https://vkvideo.ru/video_ext.php?oid=-229696756&id=456255681&hash=41066a0b1e203f04&hd=4" width="1920" height="1080" allow="autoplay; encrypted-media; fullscreen; picture-in-picture; screen-wake-lock;" frameborder="0" allowfullscreen></iframe>',
    );
    // «Добавить»
    await panel.getByRole("button", { name: "Добавить" }).click();
    // Плеер VK
    await expect(page.getByTestId("media-screen").locator("iframe")).toHaveAttribute("src", /vkvideo\.ru\/video_ext\.php\?oid=-229696756&id=456255681&hash=41066a0b1e203f04/);
    // музыка не пропала, когда появилось видео; обе графы помнятся после перезагрузки
    // Музыка на месте
    await expect(dock.getByTestId("music-frame")).toBeAttached();
    // Перезагружаем
    await page.reload();
    // Музыка помнится
    await expect(page.getByTestId("music-dock").getByTestId("music-frame")).toBeAttached();
    // Видео помнится
    await expect(page.getByTestId("media-screen").locator("iframe")).toBeAttached();
  });

  // Тёмная тема
  test("UI-16 тёмная тема сохраняется", async ({ page }) => {
    // Главная
    await page.goto("/");
    // Кнопка темы
    const toggle = page.getByRole("button", { name: /^(Тёмная|Светлая) тема$/ });
    // Тема до
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    // Переключаем
    await toggle.click();
    // Тема после
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    // Поменялась
    expect(after).not.toBe(before);
    // Перезагружаем
    await page.reload();
    // Запомнилась
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(after);
  });
});

/** Тихий WAV нужной длины — настоящий файл для <audio>, без зависимостей. */
// Тихий WAV из 8-битных отсчётов
function silentWav(seconds: number, rate = 8000): Buffer {
  // Число отсчётов
  const samples = seconds * rate;
  // Буфер: 44 байта заголовка + звук
  const b = Buffer.alloc(44 + samples);
  // Метка RIFF
  b.write("RIFF", 0);
  // Размер файла без первых 8 байт
  b.writeUInt32LE(36 + samples, 4);
  // Метки WAVE и fmt
  b.write("WAVEfmt ", 8);
  // Размер блока формата
  b.writeUInt32LE(16, 16);
  // Формат 1 — PCM без сжатия
  b.writeUInt16LE(1, 20); // PCM
  // Один канал — моно
  b.writeUInt16LE(1, 22); // моно
  // Частота
  b.writeUInt32LE(rate, 24);
  // Байт в секунду
  b.writeUInt32LE(rate, 28);
  // Байт на отсчёт
  b.writeUInt16LE(1, 32);
  // Бит на отсчёт
  b.writeUInt16LE(8, 34);
  // Метка данных
  b.write("data", 36);
  // Размер данных
  b.writeUInt32LE(samples, 40);
  // 128 — тишина для 8 бит
  b.fill(128, 44);
  // Отдаём
  return b;
}
