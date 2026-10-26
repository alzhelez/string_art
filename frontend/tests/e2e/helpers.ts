import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export const FIXTURES = path.join(__dirname, "..", "..", "..", "autotests", "fixtures");
export const PORTRAIT_JPG = path.join(FIXTURES, "portrait.jpg");
export const PORTRAIT_PNG = path.join(FIXTURES, "portrait.png");
export const FACE_JPG = path.join(FIXTURES, "face.jpg");
export const NOT_IMAGE = path.join(FIXTURES, "not-an-image.txt");

export interface ApiProject {
  id: string;
  name: string;
  diameter_cm: number;
  line_count: number;
  current_step: number;
  speed_sec: number;
  sequence: number[];
  image_id: string | null;
  prep: {
    center_x: number;
    center_y: number;
    zoom: number;
    brightness: number;
    contrast: number;
    remove_background: boolean;
    face_focus: boolean;
  };
  stats: {
    steps: number;
    raw_length_m: number;
    total_length_m: number;
    spool_m: number;
    spool_count: number;
    nail_spacing_mm: number;
  };
}

export async function createProject(
  request: APIRequestContext,
  opts: { name?: string; diameter?: number; file?: string; lines?: number } = {},
): Promise<ApiProject> {
  const file = opts.file ?? PORTRAIT_JPG;
  const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = {
    file: { name: path.basename(file), mimeType: file.endsWith(".png") ? "image/png" : "image/jpeg", buffer: fs.readFileSync(file) },
    diameter_cm: String(opts.diameter ?? 50),
  };
  if (opts.name) multipart.name = opts.name;
  const res = await request.post("/api/projects", { multipart });
  expect(res.status(), await res.text()).toBe(201);
  const project: ApiProject = await res.json();
  if (opts.lines === undefined) return project;
  // Рекомендованное число линий зависит от фото; тестам с конкретными номерами шагов нужно точное
  const patched = await request.patch(`/api/projects/${project.id}`, { data: { line_count: opts.lines } });
  expect(patched.ok()).toBeTruthy();
  return patched.json();
}

/** «2 200» с любым пробелом-разделителем (в интерфейсе — неразрывный). */
export const numRe = (n: number) =>
  new RegExp(`^${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "\\s")}$`);

export const uniqueName = (prefix: string) => `${prefix} ${Date.now().toString(36)}`;
