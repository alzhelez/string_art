"use client";

import { useEffect, useRef, useState } from "react";
import { drawBoard, type DrawOptions } from "@/lib/draw";

type Props = Omit<DrawOptions, "size"> & { label: string; maxPixels?: number };

/** Круглая картина на canvas; подстраивается под ширину контейнера и плотность экрана. */
export function Board({ label, maxPixels = 1600, ...draw }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      setSize(Math.min(maxPixels, Math.round(el.clientWidth * dpr)));
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxPixels]);

  const { sequence, lines, diameterCm, activeStep, doneOpacity } = draw;
  // Перерисовать при смене темы (подписи гвоздей берут цвет из темы)
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const mo = new MutationObserver(() => setThemeTick((t) => t + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const raf = requestAnimationFrame(() => {
      const css = getComputedStyle(document.documentElement);
      const v = (name: string) => css.getPropertyValue(name).trim() || undefined;
      const colors = { graphite: v("--text"), steel: v("--text-2"), chalk: v("--accent") };
      drawBoard(ctx, { sequence, lines, diameterCm, activeStep, doneOpacity, size, colors: colors as never });
    });
    return () => cancelAnimationFrame(raf);
  }, [sequence, lines, diameterCm, activeStep, doneOpacity, size, themeTick]);

  return (
    <div className="board" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        width={size || 1}
        height={size || 1}
        role="img"
        aria-label={label}
        data-testid="board"
        data-lines={activeStep !== undefined ? activeStep - 1 : lines}
      />
    </div>
  );
}
