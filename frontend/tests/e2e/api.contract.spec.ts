// API-тесты на TypeScript (Playwright APIRequestContext). Идут через прокси Next.js,
// поэтому заодно проверяют, что rewrite /api/* → бэкенд работает.
// Сценарии TC-API-xx совпадают с pytest/Java/Go/Ruby/C# реализациями (см. autotests/TEST_CASES.md).
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import * as C from "../../lib/constants";
import { threadStats } from "../../lib/thread";
import { createProject, FACE_JPG, NOT_IMAGE, PORTRAIT_JPG, PORTRAIT_PNG, type ApiProject } from "./helpers";

test.describe("API", () => {
  let project: ApiProject;

  test.beforeEach(async ({ request }) => {
    project = await createProject(request, { name: "API-тест" });
  });

  test.afterEach(async ({ request }) => {
    await request.delete(`/api/projects/${project.id}`);
  });

  test("TC-API-01 health", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("TC-API-02 config совпадает с константами фронтенда (контракт)", async ({ request }) => {
    const cfg = await (await request.get("/api/config")).json();
    expect(cfg.sectors).toEqual([...C.SECTORS]);
    expect(cfg.nails_per_sector).toBe(C.NAILS_PER_SECTOR);
    expect(cfg.total_nails).toBe(C.TOTAL_NAILS);
    expect(cfg.lines).toEqual({ min: C.MIN_LINES, max: C.MAX_LINES, per_cm: C.LINES_PER_CM });
    expect(cfg.diameter).toEqual({
      presets_cm: [...C.DIAMETER_PRESETS_CM],
      default_cm: C.DEFAULT_DIAMETER_CM,
      min_cm: C.MIN_DIAMETER_CM,
      max_cm: C.MAX_DIAMETER_CM,
    });
    expect(cfg.thread).toEqual({
      diameter_mm: C.THREAD_DIAMETER_MM,
      margin: C.THREAD_MARGIN,
      spools_m: [...C.STANDARD_SPOOLS_M],
      big_spool_m: C.BIG_SPOOL_M,
    });
    expect(cfg.speed).toEqual({
      default_sec: C.DEFAULT_SPEED_SEC,
      step_sec: C.SPEED_STEP_SEC,
      min_sec: C.MIN_SPEED_SEC,
      max_sec: C.MAX_SPEED_SEC,
    });
  });

  test("TC-API-03 создание проекта", async () => {
    expect(project.id).toMatch(/^[0-9a-f]{12}$/);
    expect(project.name).toBe("API-тест");
    expect(project.line_count).toBe(2000);
    expect(project.current_step).toBe(1);
    expect(project.speed_sec).toBe(2);
    expect(project.sequence).toHaveLength(5001);
    expect(project.sequence[0]).toBe(0);
    expect(project.stats.spool_m * project.stats.spool_count).toBeGreaterThanOrEqual(project.stats.total_length_m);
  });

  test("TC-API-03b фронтенд считает леску так же, как бэкенд (контракт)", async () => {
    const local = threadStats(project.sequence, project.line_count, project.diameter_cm);
    expect(local.raw_length_m).toBeCloseTo(project.stats.raw_length_m, 1);
    expect(Math.abs(local.total_length_m - project.stats.total_length_m)).toBeLessThanOrEqual(0.1);
    expect(local.spool_m).toBe(project.stats.spool_m);
    expect(local.spool_count).toBe(project.stats.spool_count);
    expect(local.nail_spacing_mm).toBe(project.stats.nail_spacing_mm);
  });

  test("TC-API-04 имя из файла, PNG с прозрачностью, 70 см", async ({ request }) => {
    const p = await createProject(request, { file: PORTRAIT_PNG, diameter: 70 });
    expect(p.name).toBe("portrait");
    expect(p.diameter_cm).toBe(70);
    expect(p.line_count).toBe(2800);
    await request.delete(`/api/projects/${p.id}`);
  });

  for (const [title, file, diameter, status] of [
    ["не картинка", NOT_IMAGE, "50", 400],
    ["диаметр меньше 20", PORTRAIT_JPG, "19.9", 422],
    ["диаметр больше 150", PORTRAIT_JPG, "150.1", 422],
  ] as const) {
    test(`TC-API-05 валидация загрузки: ${title}`, async ({ request }) => {
      const res = await request.post("/api/projects", {
        multipart: {
          file: { name: file.split("/").pop()!, mimeType: "application/octet-stream", buffer: fs.readFileSync(file) },
          diameter_cm: diameter,
        },
      });
      expect(res.status()).toBe(status);
    });
  }

  test("TC-API-07 список без sequence", async ({ request }) => {
    const list = await (await request.get("/api/projects")).json();
    const found = list.find((p: ApiProject) => p.id === project.id);
    expect(found).toBeTruthy();
    expect(found.sequence).toBeUndefined();
  });

  test("TC-API-08 неизвестный проект — 404", async ({ request }) => {
    expect((await request.get("/api/projects/000000000000")).status()).toBe(404);
  });

  test("TC-API-09/10 сохранение шага и скорости", async ({ request }) => {
    const res = await request.patch(`/api/projects/${project.id}`, { data: { current_step: 42, speed_sec: 2.04999 } });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.current_step).toBe(42);
    expect(body.speed_sec).toBe(2);
  });

  for (const body of [{ speed_sec: 0.4 }, { current_step: 2001 }, { line_count: 999 }, { name: " " }, { sequence: [] }]) {
    test(`TC-API-11 PATCH отклоняет ${JSON.stringify(body)}`, async ({ request }) => {
      expect((await request.patch(`/api/projects/${project.id}`, { data: body })).status()).toBe(422);
    });
  }

  test("TC-API-12 уменьшение линий подтягивает прогресс", async ({ request }) => {
    await request.patch(`/api/projects/${project.id}`, { data: { current_step: 1900 } });
    const body = await (await request.patch(`/api/projects/${project.id}`, { data: { line_count: 1500 } })).json();
    expect(body.current_step).toBe(1500);
  });

  test("TC-API-14 шаги непрерывны", async ({ request }) => {
    const page = await (await request.get(`/api/projects/${project.id}/steps?offset=0&limit=100`)).json();
    expect(page.items[0].from_label).toBe("A1");
    for (let i = 1; i < page.items.length; i++) {
      expect(page.items[i].from_nail).toBe(page.items[i - 1].to_nail);
    }
  });

  test("TC-API-16 PDF", async ({ request }) => {
    await request.patch(`/api/projects/${project.id}`, { data: { line_count: 1000 } });
    const res = await request.get(`/api/projects/${project.id}/instructions.pdf`);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    const buf = await res.body();
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    // 2 вводные страницы + 1000 / 200 страниц шагов
    expect((buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(7);
  });

  test("TC-API-17 удаление", async ({ request }) => {
    const p = await createProject(request);
    expect((await request.delete(`/api/projects/${p.id}`)).status()).toBe(204);
    expect((await request.get(`/api/projects/${p.id}`)).status()).toBe(404);
  });

  test("TC-API-19 загрузка фото в редактор и поиск лица", async ({ request }) => {
    const res = await request.post("/api/images", {
      multipart: { file: { name: "face.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(FACE_JPG) } },
    });
    expect(res.status()).toBe(201);
    const img = await res.json();
    expect(img.faces.length).toBeGreaterThanOrEqual(1);
    expect(img.face_prep.face_focus).toBe(true);
    const orig = await request.get(`/api/images/${img.id}/original.jpg`);
    expect(orig.headers()["content-type"]).toBe("image/jpeg");
  });

  test("TC-API-21/23 портрет из фото с кадром и правка фото", async ({ request }) => {
    const img = await (
      await request.post("/api/images", {
        multipart: { file: { name: "face.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(FACE_JPG) } },
      })
    ).json();
    const created = await request.post("/api/projects/from-image", {
      data: { image_id: img.id, name: "Из редактора", prep: { zoom: 2, center_x: 0.45, center_y: 0.3, contrast: 0.2 } },
    });
    expect(created.status()).toBe(201);
    const p: ApiProject = await created.json();
    expect(p.prep).toMatchObject({ zoom: 2, center_x: 0.45, contrast: 0.2, face_focus: false });

    await request.patch(`/api/projects/${p.id}`, { data: { current_step: 99 } });
    const updated: ApiProject = await (await request.put(`/api/projects/${p.id}/photo`, { data: img.face_prep })).json();
    expect(updated.current_step).toBe(1);
    expect(updated.prep.face_focus).toBe(true);
    expect(updated.sequence).not.toEqual(p.sequence);
    expect((await request.put(`/api/projects/${p.id}/photo`, { data: { zoom: 10 } })).status()).toBe(422);
    await request.delete(`/api/projects/${p.id}`);
  });
});
