"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ImageInfo } from "@/lib/api";
import { clampPrep, DEFAULT_PREP, normalizeCenter, type Prep } from "@/lib/prep";

export type MaskStatus = "idle" | "loading" | "ready" | "error";

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
    (async () => {
      try {
        const res = await fetch(api.maskUrl(info.id));
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(typeof body.detail === "string" ? body.detail : `Ошибка ${res.status}`);
        }
        const url = URL.createObjectURL(await res.blob());
        setMask(await loadImage(url));
        setMaskStatus("ready");
      } catch (e) {
        maskRequested.current = null;
        setMaskStatus("error");
        setMaskError(e instanceof Error ? e.message : "Не удалось убрать фон");
        setPrepState((p) => ({ ...p, remove_background: false }));
      }
    })();
  }, [info, prep.remove_background]);

  return { image, mask, maskStatus, maskError, prep, setPrep };
}
