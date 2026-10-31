// A11Y-01…05: доступность экранов по WCAG 2.1 AA (axe-core) — подписи, контраст, роли, порядок заголовков

// Проверка доступности в Playwright
import AxeBuilder from "@axe-core/playwright";
// Проверки, описание тестов, тип страницы
import { expect, test, type Page } from "@playwright/test";
// Пути к фикстурам
import path from "node:path";
// Создание проекта и уникальные названия
import { createProject, uniqueName } from "./helpers";

// Проверить страницу: нарушений WCAG 2.1 A/AA быть не должно
async function audit(page: Page, label: string) {
  // Анализ страницы
  const result = await new AxeBuilder({ page })
    // Правила WCAG 2.0/2.1 уровней A и AA
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    // Видео и встроенные проигрыватели — чужие сайты, их разметку мы не контролируем
    .exclude("iframe")
    // Запуск
    .analyze();
  // Кратко: правило, серьёзность, сколько элементов, первый элемент
  const summary = result.violations.map((v) => `${v.id} [${v.impact}] ×${v.nodes.length}: ${v.nodes[0]?.target.join(" ")} — ${v.help}`);
  // Нарушений нет (в сообщении — список)
  expect(summary, `${label}:\n${summary.join("\n")}`).toEqual([]);
}

// Главная без портретов и с портретами
test("A11Y-01 главная: выбор фото и список портретов", async ({ page, request }) => {
  // Портрет, чтобы в списке была карточка
  await createProject(request, { name: uniqueName("Доступность") });
  // Главная
  await page.goto("/");
  // Список загрузился
  await expect(page.getByTestId("project-card").first()).toBeVisible();
  // Проверка
  await audit(page, "главная");
});

// Студия портрета
test("A11Y-02 студия: ползунок, кривая, леска, кнопки", async ({ page, request }) => {
  // Портрет
  const p = await createProject(request, { name: uniqueName("Студия") });
  // Студия
  await page.goto(`/project?id=${p.id}`);
  // Название загрузилось
  await expect(page.getByLabel("Название портрета")).toBeVisible();
  // Проверка
  await audit(page, "студия");
});

// Экран плетения
test("A11Y-03 плетение: шаг, кнопки, прогресс", async ({ page, request }) => {
  // Портрет
  const p = await createProject(request, { name: uniqueName("Плетение") });
  // Плетение
  await page.goto(`/project/weave?id=${p.id}`);
  // Карточка шага
  await expect(page.getByRole("region", { name: "Текущий шаг" })).toBeVisible();
  // Проверка
  await audit(page, "плетение");
});

// Редактор фото с выбором нитей
test("A11Y-04 редактор фото и выбор нитей", async ({ page }) => {
  // Главная
  await page.goto("/");
  // Фото
  await page.getByTestId("file-input").setInputFiles(path.join(__dirname, "..", "..", "..", "autotests", "fixtures", "face.jpg"));
  // Редактор
  await expect(page.getByTestId("photo-controls")).toBeVisible();
  // Цветные нити — больше элементов управления
  await page.getByTestId("thread-picker").getByRole("radio", { name: "Цветные" }).click();
  // Проверка
  await audit(page, "редактор");
});

// Тёмная тема — тот же контраст
test("A11Y-05 тёмная тема: студия", async ({ page, request }) => {
  // Портрет
  const p = await createProject(request, { name: uniqueName("Тёмная") });
  // Тема запоминается в localStorage до загрузки страницы
  await page.addInitScript(() => localStorage.setItem("stringart.theme", "dark"));
  // Студия
  await page.goto(`/project?id=${p.id}`);
  // Тёмная тема включилась
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // Проверка
  await audit(page, "тёмная студия");
});
