// UI-сценарии (Playwright, TypeScript). Запускаются на десктопном и мобильном Chrome.
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { createProject, FACE_JPG, NOT_IMAGE, numRe, PORTRAIT_JPG, uniqueName, type ApiProject } from "./helpers";

test.describe("Новый портрет", () => {
  test("UI-01 не-картинку не принимает", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles(NOT_IMAGE);
    await expect(page.locator(".form-error")).toHaveText(/Это не изображение/);
    await expect(page.getByRole("button", { name: "Сделать портрет" })).toBeDisabled();
  });

  test("UI-02 загрузка фото → студия с расчётом лески", async ({ page }) => {
    const name = uniqueName("Портрет E2E");
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles(PORTRAIT_JPG);
    await expect(page.getByTestId("photo-controls")).toBeVisible();
    await page.getByLabel("Название").fill(name);
    await page.getByRole("radio", { name: "70" }).click();
    await page.getByRole("button", { name: "Сделать портрет" }).click();

    await expect(page).toHaveURL(/\/projects\/[0-9a-f]{12}$/);
    await expect(page.getByLabel("Название портрета")).toHaveValue(name);
    await expect(page.getByRole("radio", { name: "70" })).toHaveAttribute("aria-checked", "true");
    // Число линий — рекомендация по максимальному сходству с фото
    const id = page.url().match(/projects\/([0-9a-f]{12})/)![1];
    const sim = await (await page.request.get(`/api/projects/${id}/similarity`)).json();
    await expect(page.getByTestId("lines-value")).toHaveText(numRe(sim.best_lines));
    await expect(page.getByTestId("stat-steps")).toHaveText(numRe(sim.best_lines));
    await expect(page.getByTestId("stat-spacing")).toHaveText("9,16 мм");
    await expect(page.getByTestId("stat-spool")).toHaveText(/\d.* м$/);
    await expect(page.getByTestId("board")).toHaveAttribute("data-lines", String(sim.best_lines));
    await expect(page.getByTestId("recommendation")).toContainText("больше всего похожа на фото");
    await expect(page.getByTestId("similarity-current")).toHaveText(/Сходство с фото: \d+,\d\s%/);
  });
});

test.describe("Студия", () => {
  test("UI-03 ползунок и диаметр меняют расчёт сразу и сохраняются", async ({ page, request }) => {
    const p = await createProject(request, { name: uniqueName("Студия") });
    await page.goto(`/projects/${p.id}`);
    const spoolBefore = await page.getByTestId("stat-total").innerText();

    await page.locator("#lines").fill("4000");
    await expect(page.getByTestId("lines-value")).toHaveText("4 000");
    await expect(page.getByTestId("board")).toHaveAttribute("data-lines", "4000");
    await expect(page.getByTestId("stat-total")).not.toHaveText(spoolBefore);

    await page.getByLabel("Свой диаметр, см").fill("45,5");
    await expect(page.getByTestId("stat-spacing")).toHaveText("5,96 мм");

    await page.waitForTimeout(700); // debounce 400 мс
    await page.reload();
    await expect(page.getByTestId("lines-value")).toHaveText("4 000");
    await expect(page.getByLabel("Свой диаметр, см")).toHaveValue("45.5");
  });

  test("UI-04 скачивание PDF-инструкции", async ({ page, request }) => {
    const p = await createProject(request, { name: "Бабушка PDF" });
    await page.goto(`/projects/${p.id}`);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Скачать инструкцию PDF" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("Инструкция — Бабушка PDF.pdf");
    const file = await download.path();
    expect(fs.readFileSync(file).subarray(0, 4).toString()).toBe("%PDF");
  });

  test("UI-05 удаление портрета", async ({ page, request }) => {
    const name = uniqueName("Удалить");
    const p = await createProject(request, { name });
    await page.goto(`/projects/${p.id}`);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Удалить портрет" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test("UI-06 несуществующий проект", async ({ page }) => {
    await page.goto("/projects/000000000000");
    await expect(page.locator(".form-error")).toHaveText("Проект не найден.");
  });
});

test.describe("Плетение", () => {
  test("UI-07 автоперелистывание, скорость и сохранение шага после перезагрузки", async ({ page, request }) => {
    const p = await createProject(request, { name: uniqueName("Плетение"), lines: 2000 });
    await page.goto(`/projects/${p.id}/weave`);
    await expect(page.getByTestId("step-counter")).toHaveText(/Шаг 1 из 2\s000/);
    await expect(page.getByTestId("speed")).toHaveText("2,0 с на шаг");

    await page.getByRole("button", { name: /Быстрее/ }).click();
    await page.getByRole("button", { name: /Быстрее/ }).click();
    await expect(page.getByTestId("speed")).toHaveText("1,8 с на шаг");
    await page.getByRole("button", { name: /Медленнее/ }).click();
    await expect(page.getByTestId("speed")).toHaveText("1,9 с на шаг");

    await page.getByRole("button", { name: "Старт" }).click();
    await expect(page.getByTestId("step-counter")).toHaveText(/Шаг 3 из/, { timeout: 6000 });
    await page.getByRole("button", { name: "Пауза" }).click();
    const step = (await page.getByTestId("step-counter").innerText()).match(/Шаг (\d+)/)![1];

    await page.waitForTimeout(600);
    await page.reload();
    await expect(page.getByTestId("step-counter")).toHaveText(new RegExp(`Шаг ${step} из`));
    await expect(page.getByTestId("speed")).toHaveText("1,9 с на шаг");
    await expect(page.getByRole("button", { name: "Продолжить" })).toBeVisible();

    // текущий шаг совпадает с тем, что отдаёт API
    const steps = await (await request.get(`/api/projects/${p.id}/steps?offset=${Number(step) - 1}&limit=1`)).json();
    await expect(page.getByTestId("current-step")).toHaveText(`${steps.items[0].from_label} → ${steps.items[0].to_label}`);
  });

  test("UI-08 озвучка шага (Web Speech API подменён)", async ({ page, request }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __spoken: string[] };
      w.__spoken = [];
      Object.defineProperty(window, "speechSynthesis", {
        value: { cancel() {}, getVoices: () => [], speak: (u: { text: string }) => w.__spoken.push(u.text) },
      });
      (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
        lang = "";
        rate = 1;
        voice = null;
        constructor(public text: string) {}
      };
    });
    const p = await createProject(request);
    await page.goto(`/projects/${p.id}/weave`);
    await page.getByRole("radio", { name: "Голос" }).click();
    await expect(page.getByLabel("Что озвучивать")).toBeVisible();
    await page.getByRole("button", { name: "Вперёд" }).click();
    const spoken = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
    expect(spoken.length).toBeGreaterThanOrEqual(2);
    expect(spoken.at(-1)).toMatch(/^(А|Бэ|Цэ|Дэ) \d{1,2}$/);
  });

  test("UI-09 прогресс виден в списке портретов", async ({ page, request }) => {
    const name = uniqueName("Прогресс");
    const p = await createProject(request, { name, lines: 2000 });
    await request.patch(`/api/projects/${p.id}`, { data: { current_step: 150 } });
    await page.goto("/");
    const card = page.getByTestId("project-card").filter({ hasText: name });
    await expect(card).toContainText("Шаг 150 из 2 000");
    await card.click();
    await expect(page.getByTestId("start-weaving")).toHaveText("Продолжить с шага 150");
  });
});

test.describe("Редактор фото", () => {
  const projectIdFromUrl = (url: string) => url.match(/projects\/([0-9a-f]{12})/)![1];

  test("UI-10 кадр, яркость и «Выделить лицо» попадают в расчёт", async ({ page, request, isMobile }) => {
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles(FACE_JPG);
    await expect(page.getByTestId("photo-controls")).toBeVisible();
    const zoom = page.getByRole("slider", { name: "Масштаб" });
    await expect(zoom).toHaveValue("1");

    await page.getByLabel("Выделить лицо").check();
    expect(Number(await zoom.inputValue())).toBeGreaterThan(1.5);

    await page.getByRole("slider", { name: "Яркость" }).fill("0.1");
    if (isMobile) {
      // Эмуляция тача в Playwright не умеет «тянуть» — проверяем сдвиг с клавиатуры (тоже часть доступности)
      await page.getByTestId("photo-viewport").focus();
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowLeft");
    } else {
      // Сдвиг кадра мышью (после ползунков страница могла прокрутиться — возвращаем кадр в окно)
      await page.getByTestId("photo-viewport").scrollIntoViewIfNeeded();
      const box = (await page.getByTestId("photo-viewport").boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
      await page.mouse.up();
    }

    await page.getByLabel("Название").fill(uniqueName("Лицо"));
    await page.getByRole("button", { name: "Сделать портрет" }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f]{12}$/, { timeout: 30_000 });

    const p: ApiProject = await (await request.get(`/api/projects/${projectIdFromUrl(page.url())}`)).json();
    expect(p.prep.face_focus).toBe(true);
    expect(p.prep.brightness).toBeCloseTo(0.1, 5);
    expect(p.prep.zoom).toBeGreaterThan(1.5);
    expect(p.prep.center_x).toBeLessThan(0.4365); // сдвинули фото вправо → центр кадра левее лица
  });

  test("UI-11 «Убрать фон»", async ({ page, request }) => {
    const features = (await (await request.get("/api/config")).json()).features;
    test.skip(!features.background_removal, "на сервере не установлен rembg");
    test.setTimeout(240_000); // при самом первом запуске скачивается модель
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles(FACE_JPG);
    await page.getByLabel("Убрать фон").check();
    await expect(page.getByText("Фон станет белым")).toBeVisible({ timeout: 200_000 });
    await page.getByRole("button", { name: "Сделать портрет" }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f]{12}$/, { timeout: 30_000 });
    const p: ApiProject = await (await request.get(`/api/projects/${projectIdFromUrl(page.url())}`)).json();
    expect(p.prep.remove_background).toBe(true);
  });

  test("UI-12 правка фото готового портрета пересчитывает схему и сбрасывает прогресс", async ({ page, request }) => {
    const p = await createProject(request, { name: uniqueName("Правка"), file: FACE_JPG });
    await request.patch(`/api/projects/${p.id}`, { data: { current_step: 321 } });
    await page.goto(`/projects/${p.id}`);
    await page.getByTestId("edit-photo").click();
    await expect(page).toHaveURL(new RegExp(`/projects/${p.id}/photo$`));
    await expect(page.getByTestId("progress-warning")).toContainText("321");
    await page.getByRole("slider", { name: "Масштаб" }).fill("2");
    await page.getByRole("button", { name: "Пересчитать портрет" }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${p.id}$`), { timeout: 30_000 });
    await expect(page.getByTestId("start-weaving")).toHaveText("Начать плетение");
    const after: ApiProject = await (await request.get(`/api/projects/${p.id}`)).json();
    expect(after.prep.zoom).toBe(2);
    expect(after.sequence).not.toEqual(p.sequence);
  });
});

test.describe("Сходство, автонастройка, медиа, тема", () => {
  test("UI-13 рекомендация по сходству и кнопка «Поставить»", async ({ page, request }) => {
    const p = await createProject(request, { name: uniqueName("Сходство"), lines: 4500 });
    const sim = await (await request.get(`/api/projects/${p.id}/similarity`)).json();
    test.skip(sim.best_lines === 4500, "рекомендация совпала с выставленным значением");
    await page.goto(`/projects/${p.id}`);
    await expect(page.getByTestId("lines-value")).toHaveText(numRe(4500));
    const set = page.getByRole("button", { name: /^Поставить / });
    await expect(set).toBeVisible();
    await set.click();
    await expect(page.getByTestId("lines-value")).toHaveText(numRe(sim.best_lines));
    await expect(set).toHaveCount(0);
    await page.waitForTimeout(700); // debounce
    const after: ApiProject = await (await request.get(`/api/projects/${p.id}`)).json();
    expect(after.line_count).toBe(sim.best_lines);
  });

  test("UI-14 автонастройка фото подбирает яркость и контраст", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles(FACE_JPG);
    await expect(page.getByTestId("photo-controls")).toBeVisible();
    await page.getByRole("button", { name: "Автонастройка" }).click();
    const result = page.getByTestId("auto-result");
    await expect(result).toBeVisible({ timeout: 100_000 });
    await expect(result).toContainText(/сходство/i);
    // лицо найдено → автонастройка заодно выделила его
    await expect(page.getByLabel("Выделить лицо")).toBeChecked();
    expect(Number(await page.getByRole("slider", { name: "Масштаб" }).inputValue())).toBeGreaterThan(1.5);
  });

  test("UI-15 своя музыка во время плетения и пауза вместе с плетением", async ({ page, request }) => {
    const p = await createProject(request, { name: uniqueName("Музыка") });
    await page.goto(`/projects/${p.id}/weave`);
    const panel = page.getByTestId("media-panel");
    await panel.getByTestId("media-file-input").setInputFiles({ name: "Тишина.wav", mimeType: "audio/wav", buffer: silentWav(3) });
    const audio = panel.getByTestId("media-element");
    await expect(audio).toBeAttached();
    await expect(panel.getByRole("list", { name: "Плейлист" })).toContainText("Тишина");
    const paused = () => audio.evaluate((el: HTMLMediaElement) => el.paused);

    await page.getByRole("button", { name: "Старт" }).click();
    await expect.poll(paused).toBe(false);
    await page.getByRole("button", { name: "Пауза" }).click();
    await expect.poll(paused).toBe(true);

    // ссылки запоминаются между заходами
    await panel.getByLabel("Ссылка на видео, музыку или радио").fill("https://youtu.be/dQw4w9WgXcQ");
    await panel.getByRole("button", { name: "Добавить" }).click();
    await expect(panel.getByRole("listitem")).toHaveCount(2);
    await page.reload();
    await expect(page.getByTestId("media-panel").getByRole("listitem")).toHaveCount(1);
    await expect(page.getByTestId("media-panel").locator("iframe")).toHaveAttribute("src", /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  });

  test("UI-16 тёмная тема сохраняется", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: /^(Тёмная|Светлая) тема$/ });
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await toggle.click();
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(after).not.toBe(before);
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(after);
  });
});

/** Тихий WAV нужной длины — настоящий файл для <audio>, без зависимостей. */
function silentWav(seconds: number, rate = 8000): Buffer {
  const samples = seconds * rate;
  const b = Buffer.alloc(44 + samples);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + samples, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // моно
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write("data", 36);
  b.writeUInt32LE(samples, 40);
  b.fill(128, 44);
  return b;
}
