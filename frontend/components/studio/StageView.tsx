"use client";

import { useState } from "react";
import { num } from "@/lib/format";
import { Board } from "../Board";
import { Icon, type IconName } from "../ui/Icon";

type Mode = "threads" | "compare" | "wall";

const MODES: { id: Mode; label: string; icon: IconName }[] = [
  { id: "threads", label: "Нити", icon: "image" },
  { id: "compare", label: "Сравнить", icon: "compare" },
  { id: "wall", label: "На стене", icon: "wall" },
];

const DISTANCES = [1, 2, 3, 5];
/** Обычное расстояние до экрана. */
const SCREEN_DISTANCE_M = 0.6;
/** 1 CSS-пиксель = 1/96 дюйма. */
const MM_PER_CSS_PX = 25.4 / 96;

/**
 * Сцена студии: превью из нитей, сравнение с фото ползунком и вид «на стене» —
 * какого размера картина покажется с N метров (если экран — на расстоянии ~60 см).
 */
export function StageView({
  sequence,
  lines,
  diameterCm,
  name,
  photoUrl,
}: {
  sequence: readonly number[];
  lines: number;
  diameterCm: number;
  name: string;
  photoUrl: string;
}) {
  const [mode, setMode] = useState<Mode>("threads");
  const [split, setSplit] = useState(50);
  const [distance, setDistance] = useState(3);
  const board = <Board label={`Портрет «${name}», ${lines} линий`} sequence={sequence} lines={lines} diameterCm={diameterCm} />;
  const wallPx = Math.round((diameterCm * 10 * (SCREEN_DISTANCE_M / distance)) / MM_PER_CSS_PX);

  return (
    <div className="stage-view" data-mode={mode}>
      <div className="stage-modes segmented-wide" role="radiogroup" aria-label="Вид">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)}>
            <Icon name={m.icon} size={16} />
            {m.label}
          </button>
        ))}
      </div>

      {mode === "threads" && board}

      {mode === "compare" && (
        <div className="compare" data-testid="compare">
          {board}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="compare-photo"
            src={photoUrl}
            alt="Фото после обработки"
            style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
          />
          <span className="compare-handle" style={{ left: `${split}%` }} aria-hidden="true" />
          <span className="compare-tag left">Фото</span>
          <span className="compare-tag right">Нити</span>
          <input
            className="compare-range"
            type="range"
            min={0}
            max={100}
            value={split}
            aria-label="Граница между фото и нитями"
            onChange={(e) => setSplit(Number(e.target.value))}
          />
        </div>
      )}

      {mode === "wall" && (
        <div className="wall" data-testid="wall">
          <div className="wall-scene">
            <div className="wall-art" style={{ width: `min(100%, ${wallPx}px)` }}>
              {board}
            </div>
          </div>
          <div className="wall-distances segmented-wide" role="radiogroup" aria-label="Расстояние до картины">
            {DISTANCES.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={distance === d} onClick={() => setDistance(d)}>
                {d} м
              </button>
            ))}
          </div>
          <p className="stage-note" data-testid="wall-note">
            Так картина {num(diameterCm, diameterCm % 1 ? 1 : 0)} см видна с {distance} м, если экран — на расстоянии
            вытянутой руки.{wallPx > 640 ? " Ближе 1–2 м детали различимы, как на превью." : ""}
          </p>
        </div>
      )}
    </div>
  );
}
