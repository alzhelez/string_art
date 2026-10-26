"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type AutoTone, type Features, type ImageInfo } from "@/lib/api";
import { clampPrep, DEFAULT_PREP, normalizeCenter, type Prep } from "@/lib/prep";

export type MaskStatus = "idle" | "loading" | "ready" | "error";

interface MaskState {
  status: "idle" | "processing" | "ready" | "error";
  model: string;
  message: string | null;
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
  const [mask, setMask] = useState<HTMLImageElement | null>(null);
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
    maskJob.current = null;
    if (!info) return;
    let current = true;
    loadImage(api.imageUrl(info.id))
      .then((img) => current && setImage(img))
      .catch(() => current && setImage(null));
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
              ? "Загружаем модель удаления фона. В самый первый раз она скачивается (~170 МБ) — это может занять несколько минут."
              : "Убираем фон…",
          );
          await sleep(1000);
          st = await maskRequest(id, "GET");
        }
        const img = await loadImage(api.maskUrl(id));
        if (!alive.current) return false;
        setMask(img);
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

  return { image, mask, maskStatus, maskError, maskNote, prep, setPrep, ensureMask };
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
  const { prep, setPrep, ensureMask } = editor;

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
      const tone = await api.autoTone(info.id, next, diameterCm);
      setPrep({ ...next, brightness: tone.brightness, contrast: tone.contrast });
      setResult(tone);
      setStage("done");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Автонастройка не удалась.");
      setStage("error");
    }
  }, [info, features, prep, setPrep, ensureMask, diameterCm]);

  return { run, stage, result, error, busy: stage === "frame" || stage === "background" || stage === "tone" };
}
