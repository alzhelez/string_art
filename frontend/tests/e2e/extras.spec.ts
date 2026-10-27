// UI-21…28: шаблон разметки, кликер и голос, время и перерывы, катушка, сравнение, открытка и видео, обновление.
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { createProject, uniqueName, type ApiProject } from "./helpers";

test("UI-21 шаблон разметки 1:1 скачивается из студии", async ({ page, request }) => {
  const p = await createProject(request, { name: "Шаблон" });
  await page.goto(`/project?id=${p.id}`);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-template").click()]);
  expect(download.suggestedFilename()).toBe("Шаблон разметки — Шаблон.pdf");
  const pdf = fs.readFileSync(await download.path());
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  // 50 см на A4 — 6 листов + страница с инструкцией
  expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(7);
});

test("UI-22 кликер/педаль: PageDown, PageUp, B; проверка клавиши во вкладке", async ({ page, request }) => {
  const p = await createProject(request, { name: uniqueName("Кликер"), lines: 2000 });
  await page.goto(`/project/weave?id=${p.id}`);
  await page.getByRole("tab", { name: /Управление/ }).click();
  await page.locator("body").click({ position: { x: 5, y: 5 } }); // фокус со вкладки — на страницу
  await page.keyboard.press("PageDown");
  await page.keyboard.press("PageDown");
  await expect(page.getByTestId("step-counter")).toContainText("Шаг 3 из");
  await page.keyboard.press("PageUp");
  await expect(page.getByTestId("step-counter")).toContainText("Шаг 2 из");
  await expect(page.getByTestId("key-test")).toContainText("PageUp → назад");
  await page.keyboard.press("b");
  await expect(page.getByRole("button", { name: "Пауза" }).first()).toBeVisible();
  await page.keyboard.press("b");
  await expect(page.getByRole("button", { name: "Продолжить" })).toBeVisible();
});

test("UI-23 голосовые команды (распознавание речи подменено)", async ({ page, request }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __rec?: { onresult: (e: unknown) => void }; __say: (t: string) => void };
    // В новых Chrome есть и SpeechRecognition без префикса — подменяем оба
    const Fake = class {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult = null;
      onerror = null;
      onend = null;
      constructor() {
        w.__rec = this as never;
      }
      start() {}
      stop() {}
    };
    Object.assign(window, { SpeechRecognition: Fake, webkitSpeechRecognition: Fake });
    w.__say = (text) => w.__rec?.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
  });
  const p = await createProject(request, { name: uniqueName("Голос"), lines: 2000 });
  await page.goto(`/project/weave?id=${p.id}`);
  await page.getByRole("tab", { name: /Управление/ }).click();
  await page.getByRole("switch", { name: "Голосовые команды" }).check();
  await expect(page.getByText(/Слушаю/)).toBeVisible();
  const say = (t: string) => page.evaluate((x) => (window as unknown as { __say: (t: string) => void }).__say(x), t);
  await say("дальше");
  await say("Дальше!");
  await expect(page.getByTestId("step-counter")).toContainText("Шаг 3 из");
  await say("назад");
  await expect(page.getByTestId("step-counter")).toContainText("Шаг 2 из");
  await say("а потом мы пошли дальше гулять"); // длинная фраза из фильма — не команда
  await expect(page.getByTestId("step-counter")).toContainText("Шаг 2 из");
  await expect(page.getByTestId("voice-heard")).toContainText("а потом мы пошли дальше гулять");
});

test("UI-24 время плетения сохраняется на сервере и даёт прогноз", async ({ page, request }) => {
  const p = await createProject(request, { name: uniqueName("Время"), lines: 2000 });
  await page.goto(`/project/weave?id=${p.id}`);
  await expect(page.getByTestId("eta")).toContainText(/≈ \d+ ч/);
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Вперёд" }).click();
  await page.waitForTimeout(1500);
  // уход со страницы отправляет накопленное
  await page.getByRole("link", { name: "К настройкам портрета" }).click();
  await expect(page).toHaveURL(/\/project\?id=/);
  await expect
    .poll(async () => ((await (await request.get(`/api/projects/${p.id}`)).json()) as ApiProject & { activity: { total_steps: number } }).activity.total_steps)
    .toBeGreaterThanOrEqual(5);
  await page.goto(`/project/weave?id=${p.id}`);
  await page.getByRole("tab", { name: /Время/ }).click();
  await expect(page.getByTestId("eta-full")).toContainText("≈");
  await page.getByRole("radio", { name: "30 мин" }).click();
  await page.reload();
  await page.getByRole("tab", { name: /Время/ }).click();
  await expect(page.getByRole("radio", { name: "30 мин" })).toHaveAttribute("aria-checked", "true");
});

test("UI-25 своя катушка: план смен в студии и подсказка в плетении", async ({ page, request }) => {
  const p = await createProject(request, { name: uniqueName("Катушка"), lines: 3000 });
  await page.goto(`/project?id=${p.id}`);
  const input = page.getByLabel("Длина моей катушки, м");
  await input.fill("300");
  await input.blur();
  await expect(page.getByTestId("spool-plan")).toContainText("Понадобится");
  const first = page.getByTestId("spool-planner").getByRole("listitem").first();
  const text = await first.innerText();
  const step = Number(text.match(/После шага ([\d\s ]+)/)![1].replace(/\s/g, ""));
  const nail = text.match(/узел на ([ABCD]\d+)/)![1];
  await expect.poll(async () => (await (await request.get(`/api/projects/${p.id}`)).json()).own_spool_m).toBe(300);

  await request.patch(`/api/projects/${p.id}`, { data: { current_step: step - 5 } });
  await page.goto(`/project/weave?id=${p.id}`);
  await expect(page.getByTestId("spool-alert")).toContainText(`Через 5 шагов смена катушки`);
  await expect(page.getByTestId("spool-alert")).toContainText(nail);
});

test("UI-26 сравнение с фото и вид «на стене»", async ({ page, request }) => {
  const p = await createProject(request, { name: uniqueName("Стена") });
  await page.goto(`/project?id=${p.id}`);
  await page.getByRole("radio", { name: /Сравнить/ }).click();
  await expect(page.getByTestId("compare").getByAltText("Фото после обработки")).toBeVisible();
  await page.getByRole("slider", { name: "Граница между фото и нитями" }).fill("20");
  await expect(page.getByTestId("compare").getByAltText("Фото после обработки")).toHaveCSS("clip-path", "inset(0px 80% 0px 0px)");
  await page.getByRole("radio", { name: /На стене/ }).click();
  const art = page.getByTestId("wall").locator(".wall-art");
  const w3 = (await art.boundingBox())!.width;
  await page.getByRole("radio", { name: "5 м" }).click();
  const w5 = (await art.boundingBox())!.width;
  expect(w5).toBeLessThan(w3); // дальше — меньше
  await expect(page.getByTestId("wall-note")).toContainText("с 5 м");
});

test("UI-27 открытка и видео-таймлапс", async ({ page, request, isMobile }) => {
  test.skip(isMobile, "запись видео 10 с — проверяем на десктопе");
  test.setTimeout(90_000);
  const p = await createProject(request, { name: "Открытка" });
  await page.goto(`/project?id=${p.id}`);
  await page.getByPlaceholder(/например, «Открытка/).fill("Бабушке на юбилей");
  await page.getByTestId("make-card").click();
  const card = page.getByTestId("card-result");
  await expect(card.getByRole("img")).toBeVisible();
  const [png] = await Promise.all([page.waitForEvent("download"), card.getByRole("button", { name: /Скачать PNG/ }).click()]);
  expect(png.suggestedFilename()).toBe("Открытка.png");
  expect(fs.readFileSync(await png.path()).subarray(1, 4).toString()).toBe("PNG");

  await page.getByRole("radio", { name: "10 с" }).click();
  await page.getByTestId("make-video").click();
  await expect(page.getByTestId("video-progress")).toBeVisible();
  const result = page.getByTestId("video-result");
  await expect(result).toBeVisible({ timeout: 40_000 });
  const [video] = await Promise.all([page.waitForEvent("download"), result.getByRole("button").click()]);
  expect(video.suggestedFilename()).toMatch(/^Открытка — таймлапс\.(mp4|webm)$/);
  expect(fs.statSync(await video.path()).size).toBeGreaterThan(50_000);
});

test("UI-28 программа для Windows сообщает о новой версии", async ({ page, request }) => {
  const config = await (await request.get("/api/config")).json();
  await page.route("**/api/config", (route) => route.fulfill({ json: { ...config, app: { version: "1.4.1", desktop: true } } }));
  await page.route("https://api.github.com/**", (route) =>
    route.fulfill({
      json: {
        name: "Нитеграф для Windows 1.4.9",
        assets: [{ name: "Nitegraf-Setup.exe", browser_download_url: "https://github.com/alzhelez/string_art/releases/download/desktop-latest/Nitegraf-Setup.exe" }],
      },
    }),
  );
  await page.goto("/");
  const notice = page.getByTestId("update-notice");
  await expect(notice).toContainText("1.4.9");
  await expect(notice).toContainText("у вас 1.4.1");
  await expect(notice.getByRole("link", { name: "Скачать" })).toHaveAttribute("href", /Nitegraf-Setup\.exe$/);
  await notice.getByRole("button", { name: "Позже" }).click();
  await page.reload();
  await expect(page.getByTestId("update-notice")).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
