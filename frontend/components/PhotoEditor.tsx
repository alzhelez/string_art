"use client";

import { useEffect, useRef } from "react";
import type { MaskStatus } from "@/hooks/usePhotoEditor";
import type { Features, ImageInfo } from "@/lib/api";
import { num } from "@/lib/format";
import { DEFAULT_PREP, drawPrepared, pan, PREP_LIMITS, type Prep } from "@/lib/prep";
import { NailRing } from "./NailRing";

// --- Окно кадра ---------------------------------------------------------------
interface ViewportProps {
  info: ImageInfo;
  image: HTMLImageElement | null;
  mask: HTMLImageElement | null;
  prep: Prep;
  onChange: (p: Prep) => void;
}

/**
 * Фото внутри кольца гвоздей: тянуть — сдвиг, колесо или два пальца — масштаб.
 * Показывает ровно то, что получит алгоритм (кадр в оттенках серого).
 */
export function PhotoViewport({ info, image, mask, prep, onChange }: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const prepRef = useRef(prep);
  prepRef.current = prep;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const raf = requestAnimationFrame(() => drawPrepared(canvas, image, mask, prep));
    return () => cancelAnimationFrame(raf);
  }, [image, mask, prep]);

  // Колесо мыши: preventDefault работает только у не-passive обработчика
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = prepRef.current;
      onChange({ ...p, zoom: p.zoom * Math.exp(-e.deltaY * 0.0015) });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [onChange]);

  const viewport = () => canvasRef.current?.getBoundingClientRect().width || 1;

  return (
    <div className="editor-view">
      <NailRing className="drop-ring" />
      <canvas
        ref={canvasRef}
        className="editor-canvas"
        width={400}
        height={400}
        tabIndex={0}
        role="img"
        aria-label="Кадр портрета. Перетащите, чтобы сдвинуть; колесо мыши или клавиши плюс и минус — масштаб; стрелки — сдвиг."
        data-testid="photo-viewport"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: prepRef.current.zoom };
          }
        }}
        onPointerMove={(e) => {
          const prev = pointers.current.get(e.pointerId);
          if (!prev) return;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const p = prepRef.current;
          if (pointers.current.size === 2 && pinch.current) {
            const [a, b] = [...pointers.current.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            onChange({ ...p, zoom: pinch.current.zoom * (dist / pinch.current.dist) });
          } else if (pointers.current.size === 1) {
            onChange(pan(info.width, info.height, p, e.clientX - prev.x, e.clientY - prev.y, viewport()));
          }
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
        }}
        onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
        onKeyDown={(e) => {
          const p = prepRef.current;
          const step = viewport() / 20;
          const moves: Record<string, [number, number]> = {
            ArrowLeft: [step, 0],
            ArrowRight: [-step, 0],
            ArrowUp: [0, step],
            ArrowDown: [0, -step],
          };
          if (moves[e.key]) {
            e.preventDefault();
            onChange(pan(info.width, info.height, p, moves[e.key][0], moves[e.key][1], viewport()));
          } else if (e.key === "+" || e.key === "=") {
            onChange({ ...p, zoom: p.zoom * 1.1 });
          } else if (e.key === "-") {
            onChange({ ...p, zoom: p.zoom / 1.1 });
          }
        }}
      />
      {!image && <span className="editor-loading">Загружаем фото…</span>}
    </div>
  );
}

// --- Настройки ----------------------------------------------------------------
interface ControlsProps {
  info: ImageInfo;
  features: Features | null;
  prep: Prep;
  onChange: (p: Prep) => void;
  maskStatus: MaskStatus;
  maskError: string;
}

const percent = (v: number) => `${v > 0 ? "+" : ""}${num(Math.round(v * 100))} %`;

export function PhotoControls({ info, features, prep, onChange, maskStatus, maskError }: ControlsProps) {
  const hasFace = info.faces.length > 0 && info.face_prep !== null;
  const faceDisabled = !features?.face_detection || !hasFace;
  const bgDisabled = !features?.background_removal || maskStatus === "loading";

  return (
    <div className="photo-controls" data-testid="photo-controls">
      <p className="hint">Перетащите фото в круге, чтобы выбрать кадр. Колесо мыши или два пальца — масштаб.</p>

      <Slider
        id="prep-zoom"
        label="Масштаб"
        min={PREP_LIMITS.zoom[0]}
        max={PREP_LIMITS.zoom[1]}
        step={0.01}
        value={prep.zoom}
        display={`×${num(prep.zoom, 2)}`}
        onChange={(v) => onChange({ ...prep, zoom: v })}
      />
      <Slider
        id="prep-brightness"
        label="Яркость"
        min={PREP_LIMITS.brightness[0]}
        max={PREP_LIMITS.brightness[1]}
        step={0.01}
        value={prep.brightness}
        display={percent(prep.brightness)}
        onChange={(v) => onChange({ ...prep, brightness: v })}
      />
      <Slider
        id="prep-contrast"
        label="Контраст"
        min={PREP_LIMITS.contrast[0]}
        max={PREP_LIMITS.contrast[1]}
        step={0.01}
        value={prep.contrast}
        display={percent(prep.contrast)}
        onChange={(v) => onChange({ ...prep, contrast: v })}
      />

      <fieldset className="options">
        <legend>Дополнительно</legend>
        <label className="switch">
          <input
            type="checkbox"
            checked={prep.face_focus}
            disabled={faceDisabled}
            onChange={(e) =>
              onChange(
                e.target.checked && info.face_prep
                  ? { ...prep, ...pickFrame(info.face_prep), face_focus: true }
                  : { ...prep, face_focus: false },
              )
            }
          />
          <span>Выделить лицо</span>
        </label>
        <small className="option-note">
          {!features?.face_detection
            ? "Поиск лица не установлен на сервере (нужен пакет opencv-python-headless)."
            : hasFace
              ? "Кадр встанет на лицо, а алгоритм проработает его детальнее."
              : "Лицо анфас на фото не найдено — выберите кадр вручную."}
        </small>

        <label className="switch">
          <input
            type="checkbox"
            checked={prep.remove_background}
            disabled={bgDisabled}
            onChange={(e) => onChange({ ...prep, remove_background: e.target.checked })}
          />
          <span>Убрать фон</span>
        </label>
        <small className="option-note" role={maskStatus === "error" ? "alert" : undefined}>
          {!features?.background_removal
            ? "Не установлено на сервере: pip install -r requirements-bg.txt"
            : maskStatus === "loading"
              ? "Убираем фон… В самый первый раз сервер скачивает модель (~170 МБ), это может занять пару минут."
              : maskStatus === "error"
                ? maskError
                : "Фон станет белым — все линии уйдут на человека."}
        </small>
      </fieldset>

      <div className="photo-actions">
        <button
          type="button"
          className="btn small"
          onClick={() => onChange({ ...prep, center_x: 0.5, center_y: 0.5, zoom: 1 })}
        >
          Кадр по центру
        </button>
        <button type="button" className="btn small" onClick={() => onChange({ ...DEFAULT_PREP })}>
          Сбросить всё
        </button>
      </div>
    </div>
  );
}

function pickFrame(p: Prep): Pick<Prep, "center_x" | "center_y" | "zoom"> {
  return { center_x: p.center_x, center_y: p.center_y, zoom: p.zoom };
}

function Slider(props: {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="field slider-field">
      <div className="lines-head">
        <label htmlFor={props.id}>{props.label}</label>
        <output htmlFor={props.id}>{props.display}</output>
      </div>
      <input
        id={props.id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </div>
  );
}
