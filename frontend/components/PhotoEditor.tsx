"use client";

import { useEffect, useRef } from "react";
import type { AutoStage, BrushTool, MaskStatus } from "@/hooks/usePhotoEditor";
import type { AutoTone, Features, ImageInfo } from "@/lib/api";
import { num } from "@/lib/format";
import { cropBox, DEFAULT_PREP, drawPrepared, pan, PREP_LIMITS, type Prep } from "@/lib/prep";
import { NailRing } from "./NailRing";
import { Slider, Switch } from "./ui/Controls";
import { Icon } from "./ui/Icon";

// --- Окно кадра ---------------------------------------------------------------
export interface BrushApi {
  tool: BrushTool;
  /** Радиус кисти — доля стороны кадра. */
  size: number;
  begin: (x: number, y: number, r: number) => void;
  move: (x: number, y: number) => void;
  end: () => void;
}

interface ViewportProps {
  info: ImageInfo;
  image: HTMLImageElement | null;
  mask: HTMLCanvasElement | null;
  /** Меняется при каждой правке маски кистью — сигнал перерисовать. */
  maskVersion?: number;
  prep: Prep;
  onChange: (p: Prep) => void;
  brush?: BrushApi;
}

/**
 * Фото внутри кольца гвоздей: тянуть — сдвиг, колесо или два пальца — масштаб.
 * В режиме кисти — стирать фон или возвращать части человека.
 * Показывает ровно то, что получит алгоритм (кадр в оттенках серого).
 */
export function PhotoViewport({ info, image, mask, maskVersion = 0, prep, onChange, brush }: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const stroking = useRef(false);
  const prepRef = useRef(prep);
  prepRef.current = prep;
  const painting = Boolean(brush && brush.tool !== "move" && mask && prep.remove_background);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const raf = requestAnimationFrame(() => drawPrepared(canvas, image, mask, prep, undefined, { showRemoved: painting }));
    return () => cancelAnimationFrame(raf);
  }, [image, mask, maskVersion, prep, painting]);

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

  /** Точка на экране → пиксель исходного фото. */
  const toPhoto = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const [x0, y0, side] = cropBox(info.width, info.height, prepRef.current);
    return {
      x: x0 + ((clientX - rect.left) / rect.width) * side,
      y: y0 + ((clientY - rect.top) / rect.height) * side,
      r: (brush?.size ?? 0) * side,
    };
  };

  const moveCursor = (clientX: number, clientY: number) => {
    const el = cursorRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas || !brush) return;
    const rect = canvas.getBoundingClientRect();
    const parent = canvas.parentElement!.getBoundingClientRect();
    const d = brush.size * 2 * rect.width;
    el.style.width = el.style.height = `${d}px`;
    el.style.transform = `translate(${clientX - parent.left - d / 2}px, ${clientY - parent.top - d / 2}px)`;
  };

  return (
    <div className={`editor-view ${painting ? `is-painting is-${brush!.tool}` : ""}`}>
      <NailRing className="drop-ring" />
      <canvas
        ref={canvasRef}
        className="editor-canvas"
        width={400}
        height={400}
        tabIndex={0}
        role="img"
        aria-label={
          painting
            ? brush!.tool === "erase"
              ? "Кадр портрета. Проведите по фото, чтобы сделать это место фоном."
              : "Кадр портрета. Проведите по фото, чтобы вернуть убранную часть."
            : "Кадр портрета. Перетащите, чтобы сдвинуть; колесо мыши или клавиши плюс и минус — масштаб; стрелки — сдвиг."
        }
        data-testid="photo-viewport"
        data-tool={painting ? brush!.tool : "move"}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) {
            if (stroking.current) {
              stroking.current = false;
              brush?.end();
            }
            const [a, b] = [...pointers.current.values()];
            pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: prepRef.current.zoom };
          } else if (painting) {
            const pt = toPhoto(e.clientX, e.clientY);
            stroking.current = true;
            brush!.begin(pt.x, pt.y, pt.r);
          }
        }}
        onPointerMove={(e) => {
          if (painting) moveCursor(e.clientX, e.clientY);
          const prev = pointers.current.get(e.pointerId);
          if (!prev) return;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const p = prepRef.current;
          if (pointers.current.size === 2 && pinch.current) {
            const [a, b] = [...pointers.current.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            onChange({ ...p, zoom: pinch.current.zoom * (dist / pinch.current.dist) });
          } else if (stroking.current) {
            const pt = toPhoto(e.clientX, e.clientY);
            brush!.move(pt.x, pt.y);
          } else if (pointers.current.size === 1 && !painting) {
            onChange(pan(info.width, info.height, p, e.clientX - prev.x, e.clientY - prev.y, viewport()));
          }
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
          if (stroking.current) {
            stroking.current = false;
            brush?.end();
          }
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          if (stroking.current) {
            stroking.current = false;
            brush?.end();
          }
        }}
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
      {painting && <div ref={cursorRef} className="brush-cursor" aria-hidden="true" />}
      {!image && <span className="editor-loading">Загружаем фото…</span>}
    </div>
  );
}

// --- Настройки ----------------------------------------------------------------
export interface BrushControls {
  tool: BrushTool;
  setTool: (t: BrushTool) => void;
  size: number;
  setSize: (v: number) => void;
  canUndo: boolean;
  undo: () => void;
  edited: boolean;
  reset: () => void;
}

const TOOLS: { value: BrushTool; label: string; icon: "move" | "eraser" | "brush" }[] = [
  { value: "move", label: "Кадр", icon: "move" },
  { value: "erase", label: "Стереть", icon: "eraser" },
  { value: "restore", label: "Вернуть", icon: "brush" },
];

/** Ручная правка фона: где нейросеть ошиблась, можно стереть лишнее или вернуть нужное. */
function BrushPanel({ b }: { b: BrushControls }) {
  return (
    <div className="brush-panel" data-testid="brush-panel">
      <p className="brush-title">Поправить фон кистью</p>
      <div className="segmented-wide" role="radiogroup" aria-label="Инструмент">
        {TOOLS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={b.tool === t.value}
            onClick={() => b.setTool(t.value)}
          >
            <Icon name={t.icon} size={18} />
            {t.label}
          </button>
        ))}
      </div>
      {b.tool !== "move" && (
        <Slider
          id="brush-size"
          label="Размер кисти"
          min={0.01}
          max={0.12}
          step={0.005}
          value={b.size}
          display={`${num(Math.round(b.size * 200))} %`}
          onChange={b.setSize}
        />
      )}
      <small className="muted">
        {b.tool === "erase"
          ? "Проведите по лишнему — оно станет фоном."
          : b.tool === "restore"
            ? "Проведите по бледно-розовому — эта часть вернётся."
            : "Выберите «Стереть» или «Вернуть» и проведите по фото. Убранный фон в режиме кисти виден бледно-розовым."}
      </small>
      <div className="photo-actions">
        <button type="button" className="btn ghost small" onClick={b.undo} disabled={!b.canUndo}>
          <Icon name="undo" size={18} />
          Отменить
        </button>
        <button type="button" className="btn ghost small" onClick={b.reset} disabled={!b.edited && !b.canUndo}>
          Вернуть как было
        </button>
      </div>
    </div>
  );
}

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
  tone: "Подбираем яркость и контраст: пробуем 6 вариантов и сравниваем результат нитями с фото (15–20 секунд)…",
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
            {r.score_after > r.score_before + 1e-4 ? (
              <>
                Сходство с фото выросло на <strong>{gain(r)}</strong>.
              </>
            ) : (
              <>Фото и так подходит — сходство с фото уже лучшее.</>
            )}{" "}
            Яркость {percent(r.brightness)}, контраст {percent(r.contrast)}.
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

const gain = (r: AutoTone) => `${num(((r.score_after - r.score_before) / Math.max(1e-6, r.score_before)) * 100, 1)} %`;

export function PhotoControls({
  info,
  features,
  prep,
  onChange,
  maskStatus,
  maskError,
  maskNote,
  auto,
  brush,
}: ControlsProps & { auto?: AutoProps; brush?: BrushControls }) {
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
      {brush && prep.remove_background && maskStatus === "ready" && <BrushPanel b={brush} />}

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
