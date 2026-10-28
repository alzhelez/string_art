// Тип клиента запросов Playwright
import type { APIRequestContext } from "@playwright/test";
// Проверки Playwright
import { expect } from "@playwright/test";
// fs — читаем фикстуры
import fs from "node:fs";
// path — собираем пути
import path from "node:path";

// Общая папка фикстур в autotests
export const FIXTURES = path.join(__dirname, "..", "..", "..", "autotests", "fixtures");
// Фото в JPEG
export const PORTRAIT_JPG = path.join(FIXTURES, "portrait.jpg");
// PNG с прозрачностью
export const PORTRAIT_PNG = path.join(FIXTURES, "portrait.png");
// Фото с лицом
export const FACE_JPG = path.join(FIXTURES, "face.jpg");
// Текстовый файл вместо картинки
export const NOT_IMAGE = path.join(FIXTURES, "not-an-image.txt");

// Форма проекта, как её отдаёт API:
export interface ApiProject {
  // id
  id: string;
  // название
  name: string;
  // диаметр
  diameter_cm: number;
  // число нитей
  line_count: number;
  // текущий шаг
  current_step: number;
  // скорость
  speed_sec: number;
  // схема
  sequence: number[];
  // картинка
  image_id: string | null;
  // параметры кадра:
  prep: {
    // центр по X
    center_x: number;
    // центр по Y
    center_y: number;
    // зум
    zoom: number;
    // яркость
    brightness: number;
    // контраст
    contrast: number;
    // удалить фон
    remove_background: boolean;
    // выделить лицо
    face_focus: boolean;
  };
  // расчёт лески:
  stats: {
    // шагов
    steps: number;
    // чистая длина
    raw_length_m: number;
    // с запасом
    total_length_m: number;
    // катушка
    spool_m: number;
    // сколько катушек
    spool_count: number;
    // расстояние между гвоздями
    nail_spacing_mm: number;
  };
}

// Создаёт проект через API, чтобы не проходить интерфейс в каждом тесте
export async function createProject(
  // клиент запросов
  request: APIRequestContext,
  // необязательные название, диаметр, файл и число нитей
  opts: { name?: string; diameter?: number; file?: string; lines?: number } = {},
// отдаёт проект
): Promise<ApiProject> {
  // Файл по умолчанию — портрет
  const file = opts.file ?? PORTRAIT_JPG;
  // Поля формы:
  const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = {
    // файл с правильным MIME
    file: { name: path.basename(file), mimeType: file.endsWith(".png") ? "image/png" : "image/jpeg", buffer: fs.readFileSync(file) },
    // диаметр строкой
    diameter_cm: String(opts.diameter ?? 50),
  };
  // Название — только если задано
  if (opts.name) multipart.name = opts.name;
  // Создаём
  const res = await request.post("/api/projects", { multipart });
  // Ожидаем 201; при ошибке в отчёте будет тело ответа
  expect(res.status(), await res.text()).toBe(201);
  // Проект
  const project: ApiProject = await res.json();
  // Число нитей не задано — готово
  if (opts.lines === undefined) return project;
  // Рекомендованное число линий зависит от фото; тестам с конкретными номерами шагов нужно точное
  // Задаём точное число нитей
  const patched = await request.patch(`/api/projects/${project.id}`, { data: { line_count: opts.lines } });
  // Изменение прошло
  expect(patched.ok()).toBeTruthy();
  // Отдаём обновлённый проект
  return patched.json();
}

/** «2 200» с любым пробелом-разделителем (в интерфейсе — неразрывный). */
// Регулярное выражение для числа с разделителем тысяч — так проверяем числа на экране
export const numRe = (n: number) =>
  // Строим шаблон: между группами по 3 цифры — любой пробел; ^ и $ — число целиком
  new RegExp(`^${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "\\s")}$`);

// Уникальное название: префикс + время в 36-ричной записи — проекты разных тестов не путаются
export const uniqueName = (prefix: string) => `${prefix} ${Date.now().toString(36)}`;
