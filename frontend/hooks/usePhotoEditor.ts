"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type AutoTone, type Features, type ImageInfo } from "@/lib/api";
import { clampPrep, DEFAULT_PREP, normalizeCenter, type Prep } from "@/lib/prep";

export type MaskStatus = "idle" | "loading" | "ready" | "error";

interface MaskState {
  status: "idle" | "processing" | "ready" | "error";
  model: string;
  message: string | null;
  edited?: boolean;
  progress?: number | null;
}

/** Инструмент в окне кадра: двигать кадр или поправлять маску фона кистью. */
export type BrushTool = "move" | "erase" | "restore";

const UNDO_LIMIT = 8;

/** Маска как редактируемый canvas в размере самой маски (= размер фото). */
function maskCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  c.getContext("2d", { willReadFrequently: true })?.drawImage(img, 0, 0);
  return c;
}

async function maskRequest(id: string, method: "GET" | "POST"): Promise<MaskState> {
  let res: Response;
  try {
    res = await fetch(`/api/images/${id}/mask`, { method });
  } catch {
    throw new Error("Сервер не отвечает. Проверьте, что бэкенд запущен.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 202) {
    throw new Error(typeof body.detail === "string" ? body.detail : `Ошибка ${res.status}`);
  }
  return body as MaskState;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  return img;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Состояние редактора: само фото, маска фона и параметры кадра. */
export function usePhotoEditor(info: ImageInfo | null, initial?: Partial<Prep>) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageError, setImageError] = useState(false);
  const [mask, setMask] = useState<HTMLCanvasElement | null>(null);
  const [maskVersion, setMaskVersion] = useState(0);
  const [maskEdited, setMaskEdited] = useState(false);
  const [tool, setTool] = useState<BrushTool>("move");
  const [brushSize, setBrushSize] = useState(0.04);
  const [canUndo, setCanUndo] = useState(false);
  const undoStack = useRef<ImageData[]>([]);
  const lastPoint = useRef<{ x: number; y: number; r: number } | null>(null);
  const dirty = useRef(false);
  const uploadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploading = useRef<Promise<void>>(Promise.resolve());
  const frame = useRef(0);
  const [maskStatus, setMaskStatus] = useState<MaskStatus>("idle");
  const [maskError, setMaskError] = useState("");
  const [maskNote, setMaskNote] = useState("");
  const [prep, setPrepState] = useState<Prep>({ ...DEFAULT_PREP, ...initial });
  const maskJob = useRef<{ id: string; promise: Promise<boolean> } | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    setImage(null);
    setMask(null);
    setMaskStatus("idle");
    setMaskEdited(false);
    setTool("move");
    undoStack.current = [];
    setCanUndo(false);
    dirty.current = false;
    maskJob.current = null;
    if (!info) return;
    let current = true;
    setImageError(false);
    // Сервер мог быть занят (первый запуск, скачивание модели) — пробуем ещё пару раз
    (async () => {
      for (let attempt = 0; attempt < 3 && current; attempt++) {
        try {
          const img = await loadImage(api.imageUrl(info.id));
          if (current) setImage(img);
          return;
        } catch {
          await sleep(1000 * (attempt + 1));
        }
      }
      if (current) setImageError(true);
    })();
    return () => {
      current = false;
    };
  }, [info]);

  const setPrep = useCallback(
    (next: Prep) => {
      const p = clampPrep(next);
      setPrepState(info ? normalizeCenter(info.width, info.height, p) : p);
    },
    [info],
  );

  /**
   * Маска фона считается на сервере в фоне: запускаем задачу и опрашиваем статус.
   * Ни один запрос не висит долго (прокси Next.js обрывает их через 30 с).
   * Возвращает true, когда маска загружена.
   */
  const ensureMask = useCallback((): Promise<boolean> => {
    if (!info) return Promise.resolve(false);
    if (maskJob.current?.id === info.id) return maskJob.current.promise;
    const id = info.id;
    setMaskStatus("loading");
    setMaskError("");
    setMaskNote("");
    const promise = (async () => {
      try {
        let st = await maskRequest(id, "POST");
        while (st.status !== "ready") {
          if (!alive.current) return false;
          if (st.status === "error") throw new Error(st.message ?? "Не удалось убрать фон");
          setMaskNote(
            st.model === "loading"
              ? typeof st.progress === "number"
                ? `Скачиваем модель удаления фона: ${Math.round(st.progress * 100)} % из ~170 МБ. Это нужно один раз.`
                : "Загружаем модель удаления фона. В самый первый раз она скачивается (~170 МБ) — это может занять несколько минут."
              : "Убираем фон…",
          );
          await sleep(1000);
          st = await maskRequest(id, "GET");
        }
        const img = await loadImage(`${api.maskUrl(id)}?v=${Date.now()}`);
        if (!alive.current) return false;
        setMask(maskCanvas(img));
        setMaskEdited(Boolean(st.edited));
        setMaskStatus("ready");
        setMaskNote("");
        return true;
      } catch (e) {
        maskJob.current = null;
        if (alive.current) {
          setMaskStatus("error");
          setMaskError(e instanceof Error ? e.message : "Не удалось убрать фон");
          setPrepState((p) => ({ ...p, remove_background: false }));
        }
        return false;
      }
    })();
    maskJob.current = { id, promise };
    return promise;
  }, [info]);

  useEffect(() => {
    if (prep.remove_background) void ensureMask();
  }, [prep.remove_background, ensureMask]);

  // --- кисть: правка маски фона -------------------------------------------------
  const bump = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setMaskVersion((v) => v + 1);
    });
  }, []);

  const upload = useCallback(async () => {
    if (!info || !mask || !dirty.current) return;
    dirty.current = false;
    const blob = await new Promise<Blob | null>((resolve) => mask.toBlob(resolve, "image/png"));
    if (!blob) return;
    const res = await fetch(`/api/images/${info.id}/mask.png`, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: blob,
    }).catch(() => null);
    if (!res?.ok) {
      dirty.current = true;
      if (alive.current) setMaskError("Правка фона не сохранилась — проверьте связь с сервером.");
      return;
    }
    if (alive.current) {
      setMaskEdited(true);
      setMaskError("");
    }
  }, [info, mask]);

  const scheduleUpload = useCallback(() => {
    dirty.current = true;
    if (uploadTimer.current) clearTimeout(uploadTimer.current);
    uploadTimer.current = setTimeout(() => {
      uploadTimer.current = null;
      uploading.current = uploading.current.then(upload);
    }, 600);
  }, [upload]);

  /** Дождаться, пока правки кистью дойдут до сервера (перед расчётом портрета). */
  const flushMask = useCallback(async () => {
    if (uploadTimer.current) {
      clearTimeout(uploadTimer.current);
      uploadTimer.current = null;
      uploading.current = uploading.current.then(upload);
    }
    await uploading.current;
  }, [upload]);

  const paint = useCallback(
    (x0: number, y0: number, x1: number, y1: number, r: number, mode: BrushTool) => {
      const ctx = mask?.getContext("2d");
      if (!ctx || !info) return;
      const k = mask!.width / info.width; // маска и фото одного размера, но на всякий случай
      ctx.save();
      ctx.strokeStyle = ctx.fillStyle = mode === "erase" ? "#000" : "#fff";
      ctx.lineWidth = 2 * r * k;
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(x0 * k, y0 * k);
      ctx.lineTo(x1 * k + 0.01, y1 * k);
      ctx.stroke();
      ctx.restore();
      bump();
    },
    [mask, info, bump],
  );

  /** Кисть: координаты — в пикселях исходного фото, r — радиус там же. */
  const brush = {
    begin: (x: number, y: number, r: number) => {
      const ctx = mask?.getContext("2d", { willReadFrequently: true });
      if (!ctx || tool === "move") return;
      undoStack.current.push(ctx.getImageData(0, 0, mask!.width, mask!.height));
      if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
      setCanUndo(true);
      lastPoint.current = { x, y, r };
      paint(x, y, x, y, r, tool);
    },
    move: (x: number, y: number) => {
      const last = lastPoint.current;
      if (!last) return;
      paint(last.x, last.y, x, y, last.r, tool);
      lastPoint.current = { ...last, x, y };
    },
    end: () => {
      if (!lastPoint.current) return;
      lastPoint.current = null;
      scheduleUpload();
    },
  };

  const undo = useCallback(() => {
    const ctx = mask?.getContext("2d");
    const snap = undoStack.current.pop();
    if (ctx && snap) {
      ctx.putImageData(snap, 0, 0);
      bump();
      scheduleUpload();
    }
    setCanUndo(undoStack.current.length > 0);
  }, [mask, bump, scheduleUpload]);

  /** Вернуть автоматическую маску (отменить все правки кистью). */
  const resetMask = useCallback(async () => {
    if (!info) return;
    if (uploadTimer.current) clearTimeout(uploadTimer.current);
    uploadTimer.current = null;
    dirty.current = false;
    await uploading.current;
    await fetch(`/api/images/${info.id}/mask/edits`, { method: "DELETE" }).catch(() => null);
    undoStack.current = [];
    setCanUndo(false);
    maskJob.current = null;
    await ensureMask();
  }, [info, ensureMask]);

  useEffect(() => {
    if (!prep.remove_background || maskStatus !== "ready") setTool("move");
  }, [prep.remove_background, maskStatus]);

  return {
    image,
    imageError,
    mask,
    maskVersion,
    maskStatus,
    maskError,
    maskNote,
    maskEdited,
    prep,
    setPrep,
    ensureMask,
    flushMask,
    tool,
    setTool,
    brushSize,
    setBrushSize,
    brush,
    canUndo,
    undo,
    resetMask,
  };
}

export type AutoStage = "idle" | "frame" | "background" | "tone" | "done" | "error";

/**
 * «Автонастройка»: кадр по лицу → удаление фона → подбор яркости и контраста
 * перебором на сервере (по сходству нитяной картины с исходным фото).
 */
export function useAutoPrep(
  info: ImageInfo | null,
  features: Features | null,
  editor: ReturnType<typeof usePhotoEditor>,
  diameterCm: number,
) {
  const [stage, setStage] = useState<AutoStage>("idle");
  const [result, setResult] = useState<AutoTone | null>(null);
  const [error, setError] = useState("");
  const { prep, setPrep, ensureMask, flushMask } = editor;

  const run = useCallback(async () => {
    if (!info) return;
    setError("");
    setResult(null);
    try {
      let next: Prep = { ...prep, brightness: 0, contrast: 0 };
      setStage("frame");
      const face = features?.face_detection ? info.face_prep : null;
      if (face) {
        next = { ...next, center_x: face.center_x, center_y: face.center_y, zoom: face.zoom, face_focus: true };
      }
      if (features?.background_removal && face) {
        next = { ...next, remove_background: true };
        setPrep(next);
        setStage("background");
        if (!(await ensureMask())) next = { ...next, remove_background: false };
      }
      setPrep(next);
      setStage("tone");
      await flushMask();
      const tone = await api.autoTone(info.id, next, diameterCm);
      setPrep({ ...next, brightness: tone.brightness, contrast: tone.contrast });
      setResult(tone);
      setStage("done");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Автонастройка не удалась.");
      setStage("error");
    }
  }, [info, features, prep, setPrep, ensureMask, flushMask, diameterCm]);

  return { run, stage, result, error, busy: stage === "frame" || stage === "background" || stage === "tone" };
}
