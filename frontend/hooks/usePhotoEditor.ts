"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ImageInfo } from "@/lib/api";
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

/** Состояние редактора: само фото, маска фона и параметры кадра. */
export function usePhotoEditor(info: ImageInfo | null, initial?: Partial<Prep>) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [mask, setMask] = useState<HTMLImageElement | null>(null);
  const [maskStatus, setMaskStatus] = useState<MaskStatus>("idle");
  const [maskError, setMaskError] = useState("");
  const [maskNote, setMaskNote] = useState("");
  const [prep, setPrepState] = useState<Prep>({ ...DEFAULT_PREP, ...initial });
  const maskRequested = useRef<string | null>(null);

  useEffect(() => {
    setImage(null);
    setMask(null);
    setMaskStatus("idle");
    maskRequested.current = null;
    if (!info) return;
    let alive = true;
    loadImage(api.imageUrl(info.id))
      .then((img) => alive && setImage(img))
      .catch(() => alive && setImage(null));
    return () => {
      alive = false;
    };
  }, [info]);

  const setPrep = useCallback(
    (next: Prep) => {
      const p = clampPrep(next);
      setPrepState(info ? normalizeCenter(info.width, info.height, p) : p);
    },
    [info],
  );

  // Маска нужна только когда включено удаление фона; считается на бэкенде один раз.
  useEffect(() => {
    if (!info || !prep.remove_background || maskRequested.current === info.id) return;
    maskRequested.current = info.id;
    setMaskStatus("loading");
    setMaskError("");
    setMaskNote("");
    let alive = true;
    (async () => {
      try {
        // Фон убирается на сервере в фоне: запускаем задачу и опрашиваем статус.
        // Так ни один запрос не висит долго (прокси Next.js обрывает их через 30 с).
        let st = await maskRequest(info.id, "POST");
        while (alive && st.status !== "ready") {
          if (st.status === "error") throw new Error(st.message ?? "Не удалось убрать фон");
          setMaskNote(
            st.model === "loading"
              ? "Загружаем модель удаления фона. В самый первый раз она скачивается (~170 МБ) — это может занять несколько минут."
              : "Убираем фон…",
          );
          await new Promise((r) => setTimeout(r, 1000));
          st = await maskRequest(info.id, "GET");
        }
        if (!alive) return;
        setMask(await loadImage(api.maskUrl(info.id)));
        setMaskStatus("ready");
        setMaskNote("");
      } catch (e) {
        if (!alive) return;
        maskRequested.current = null;
        setMaskStatus("error");
        setMaskError(e instanceof Error ? e.message : "Не удалось убрать фон");
        setPrepState((p) => ({ ...p, remove_background: false }));
      }
    })();
    return () => {
      alive = false;
      if (maskRequested.current === info.id) maskRequested.current = null;
    };
  }, [info, prep.remove_background]);

  return { image, mask, maskStatus, maskError, maskNote, prep, setPrep };
}
