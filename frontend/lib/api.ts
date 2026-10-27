import type { Prep } from "./prep";
import type { ThreadStats } from "./thread";

export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageInfo {
  id: string;
  width: number;
  height: number;
  faces: FaceBox[];
  has_mask: boolean;
  face_prep: Prep | null;
}

export interface Similarity {
  diameter_cm: number;
  best_lines: number;
  best_score: number;
  curve: { lines: number; score: number }[];
}

export interface AutoTone {
  brightness: number;
  contrast: number;
  score_before: number;
  score_after: number;
  lines_before: number;
  best_lines: number;
  candidates: number;
}

export interface Features {
  face_detection: boolean;
  background_removal: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  diameter_cm: number;
  line_count: number;
  current_step: number;
  speed_sec: number;
  image_id: string | null;
  prep: Partial<Prep>;
  stats: ThreadStats;
}

export interface Project extends ProjectSummary {
  /** Гвозди по порядку; длина 5001, первый — A1. */
  sequence: number[];
}

export type ProjectPatch = Partial<
  Pick<Project, "name" | "diameter_cm" | "line_count" | "current_step" | "speed_sec">
>;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, "Сервер не отвечает. Проверьте, что бэкенд запущен на порту 8000.");
  }
  if (!res.ok) {
    let message = `Ошибка ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail) && body.detail[0]?.msg) message = body.detail[0].msg;
    } catch {
      /* тело не JSON — оставляем код ошибки */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  list: () => request<ProjectSummary[]>("/api/projects", { cache: "no-store" }),
  get: (id: string) =>
    /^[0-9a-f]{12}$/.test(id)
      ? request<Project>(`/api/projects/${id}`, { cache: "no-store" })
      : Promise.reject(new ApiError(404, "Проект не найден")),
  create: (file: Blob, filename: string, name: string, diameterCm: number) => {
    const form = new FormData();
    form.append("file", file, filename);
    if (name.trim()) form.append("name", name.trim());
    form.append("diameter_cm", String(diameterCm));
    return request<Project>("/api/projects", { method: "POST", body: form });
  },
  update: (id: string, patch: ProjectPatch, keepalive = false) =>
    request<Project>(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
      keepalive,
    }),
  remove: (id: string) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),
  features: async (): Promise<Features> => (await request<{ features: Features }>("/api/config")).features,
  uploadImage: (file: Blob, filename: string) => {
    const form = new FormData();
    form.append("file", file, filename);
    return request<ImageInfo>("/api/images", { method: "POST", body: form });
  },
  image: (id: string) => request<ImageInfo>(`/api/images/${id}`),
  createFromImage: (body: { image_id: string; name: string; diameter_cm: number; prep: Prep }) =>
    request<Project>("/api/projects/from-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, name: body.name.trim() || null }),
    }),
  updatePhoto: (id: string, prep: Prep) =>
    request<Project>(`/api/projects/${id}/photo`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prep),
    }),
  similarity: (id: string, diameterCm?: number) =>
    request<Similarity>(
      `/api/projects/${id}/similarity${diameterCm !== undefined ? `?diameter_cm=${diameterCm}` : ""}`,
    ),
  autoTone: (imageId: string, prep: Prep, diameterCm: number) =>
    request<AutoTone>(`/api/images/${imageId}/auto-tone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prep, diameter_cm: diameterCm }),
    }),
  imageUrl: (id: string) => `/api/images/${id}/original.jpg`,
  maskUrl: (id: string) => `/api/images/${id}/mask.png`,
  previewUrl: (id: string, size: number, lines?: number) =>
    `/api/projects/${id}/preview.png?size=${size}${lines ? `&lines=${lines}` : ""}`,
  sourceUrl: (id: string) => `/api/projects/${id}/source.png`,
  pdfUrl: (id: string) => `/api/projects/${id}/instructions.pdf`,
};
