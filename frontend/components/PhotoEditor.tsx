"use client";

import { useEffect, useRef } from "react";
import type { AutoStage, MaskStatus } from "@/hooks/usePhotoEditor";
import type { AutoTone, Features, ImageInfo } from "@/lib/api";
import { num } from "@/lib/format";
import { DEFAULT_PREP, drawPrepared, pan, PREP_LIMITS, type Prep } from "@/lib/prep";
import { NailRing } from "./NailRing";
import { Slider, Switch } from "./ui/Controls";
import { Icon } from "./ui/Icon";

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
  maskNote?: string;
}

const percent = (v: number) => `${v > 0 ? "+" : ""}${num(Math.round(v * 100))} %`;

export interface AutoProps {
  run: () => void;
  busy: boolean;
  stage: AutoStage;
  result: AutoTone | null;
  error: string;
}

const AUTO_STAGE_TEXT: Partial<Record<AutoStage, string>> = {
  frame: "Ищем лицо и выбираем кадр…",
  background: "Убираем фон…",
  tone: "Подбираем яркость и контраст: пробуем 6 вариантов и сравниваем результат нитями с фото…",
};

function AutoPanel({ auto }: { auto: AutoProps }) {
  const r = auto.result;
  return (
    <div className="auto-panel" data-testid="auto-panel">
      <button type="button" className="btn tonal wide" onClick={auto.run} disabled={auto.busy}>
        <Icon name="wand" />
        {auto.busy ? "Настраиваем…" : "Автонастройка"}
      </button>
      <p className="auto-note" aria-live="polite">
        {auto.busy ? (
          AUTO_STAGE_TEXT[auto.stage]
        ) : auto.stage === "done" && r ? (
          <span data-testid="auto-result">
            Сходство с фото {pct(r.score_before)} → <strong>{pct(r.score_after)}</strong>. Яркость {percent(r.brightness)},
            контраст {percent(r.contrast)}.
          </span>
        ) : auto.stage === "error" ? (
          <span role="alert" className="text-danger">
            {auto.error}
          </span>
        ) : (
          "Сама выберет кадр по лицу, уберёт фон и подберёт яркость и контраст так, чтобы картина из нитей была максимально похожа на фото."
        )}
      </p>
    </div>
  );
}

const pct = (v: number) => `${num(v * 100, 1)} %`;

export function PhotoControls({
  info,
  features,
  prep,
  onChange,
  maskStatus,
  maskError,
  maskNote,
  auto,
}: ControlsProps & { auto?: AutoProps }) {
  const hasFace = info.faces.length > 0 && info.face_prep !== null;
  const faceDisabled = !features?.face_detection || !hasFace;
  const bgDisabled = !features?.background_removal || maskStatus === "loading";

  return (
    <div className="photo-controls" data-testid="photo-controls">
      {auto && <AutoPanel auto={auto} />}

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

      <div className="switch-list">
        <Switch
          label="Выделить лицо"
          checked={prep.face_focus}
          disabled={faceDisabled}
          onChange={(on) =>
            onChange(
              on && info.face_prep
                ? { ...prep, ...pickFrame(info.face_prep), face_focus: true }
                : { ...prep, face_focus: false },
            )
          }
          hint={
            !features?.face_detection
              ? "Поиск лица не установлен на сервере (нужен пакет opencv-python-headless)."
              : hasFace
                ? "Кадр встанет на лицо, а алгоритм проработает его детальнее."
                : "Лицо анфас на фото не найдено — выберите кадр вручную."
          }
        />
        <Switch
          label="Убрать фон"
          checked={prep.remove_background}
          disabled={bgDisabled}
          onChange={(on) => onChange({ ...prep, remove_background: on })}
          hintRole={maskStatus === "error" ? "alert" : undefined}
          hint={
            features === null
              ? "Нет связи с бэкендом — проверьте, что он запущен, и обновите страницу."
              : !features.background_removal
                ? "Не установлено на сервере. В папке backend выполните pip install -r requirements-bg.txt и перезапустите бэкенд."
                : maskStatus === "loading"
                  ? maskNote || "Убираем фон…"
                  : maskStatus === "error"
                    ? maskError
                    : "Фон станет белым — все линии уйдут на человека."
          }
        />
      </div>

      <div className="photo-actions">
        <button
          type="button"
          className="btn ghost small"
          onClick={() => onChange({ ...prep, center_x: 0.5, center_y: 0.5, zoom: 1 })}
        >
          Кадр по центру
        </button>
        <button type="button" className="btn ghost small" onClick={() => onChange({ ...DEFAULT_PREP })}>
          Сбросить всё
        </button>
      </div>
    </div>
  );
}

function pickFrame(p: Prep): Pick<Prep, "center_x" | "center_y" | "zoom"> {
  return { center_x: p.center_x, center_y: p.center_y, zoom: p.zoom };
}
