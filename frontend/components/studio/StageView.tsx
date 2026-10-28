// Компонент работает в браузере
"use client";

// Состояние React
import { useState } from "react";
// Числа по-русски
import { num } from "@/lib/format";
// Картина на холсте
import { Board } from "../Board";
// Иконки и тип имени иконки
import { Icon, type IconName } from "../ui/Icon";

// Режимы сцены: нити / сравнение с фото / на стене
type Mode = "threads" | "compare" | "wall";

// Кнопки режимов
const MODES: { id: Mode; label: string; icon: IconName }[] = [
  // Нити
  { id: "threads", label: "Нити", icon: "image" },
  // Сравнение
  { id: "compare", label: "Сравнить", icon: "compare" },
  // На стене
  { id: "wall", label: "На стене", icon: "wall" },
];

// С каких расстояний (м) можно посмотреть «на стене»
const DISTANCES = [1, 2, 3, 5];
/** Обычное расстояние до экрана. */
// Человек сидит в ~60 см от экрана
const SCREEN_DISTANCE_M = 0.6;
/** 1 CSS-пиксель = 1/96 дюйма. */
// Миллиметров в одном CSS-пикселе
const MM_PER_CSS_PX = 25.4 / 96;

/**
 * Сцена студии: превью из нитей, сравнение с фото ползунком и вид «на стене» —
 * какого размера картина покажется с N метров (если экран — на расстоянии ~60 см).
 */
// Сцена студии
export function StageView({
  // Последовательность
  sequence,
  // Число линий
  lines,
  // Диаметр
  diameterCm,
  // Название
  name,
  // Адрес подготовленного фото
  photoUrl,
// Типы свойств
}: {
  // Последовательность
  sequence: readonly number[];
  // Линии
  lines: number;
  // Диаметр
  diameterCm: number;
  // Название
  name: string;
  // Адрес фото
  photoUrl: string;
// Тело компонента
}) {
  // Текущий режим
  const [mode, setMode] = useState<Mode>("threads");
  // Положение границы сравнения, % слева
  const [split, setSplit] = useState(50);
  // Выбранное расстояние, м
  const [distance, setDistance] = useState(3);
  // Картина — общая для всех режимов
  const board = <Board label={`Портрет «${name}», ${lines} линий`} sequence={sequence} lines={lines} diameterCm={diameterCm} />;
  // Видимый размер на экране: диаметр × (0,6 м / расстояние), переведённый в CSS-пиксели
  const wallPx = Math.round((diameterCm * 10 * (SCREEN_DISTANCE_M / distance)) / MM_PER_CSS_PX);

  // Разметка
  return (
    // Сцена; data-mode — для стилей
    <div className="stage-view" data-mode={mode}>
      {/* Переключатель режимов */}
      <div className="stage-modes segmented-wide" role="radiogroup" aria-label="Вид">
        {/* Кнопка на каждый режим */}
        {MODES.map((m) => (
          // Кнопка-переключатель
          <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)}>
            {/* Иконка */}
            <Icon name={m.icon} size={16} />
            {/* Подпись */}
            {m.label}
          </button>
        ))}
      </div>

      {/* Режим «нити» — просто картина */}
      {mode === "threads" && board}

      {/* Режим «сравнить» */}
      {mode === "compare" && (
        // Блок сравнения
        <div className="compare" data-testid="compare">
          {/* Картина снизу */}
          {board}
          {/* Отключаем правило линтера: обычный img проще (фото отдаёт наш API) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {/* Фото поверх картины, обрезанное справа по положению ползунка */}
          <img
            // Стиль
            className="compare-photo"
            // Адрес фото
            src={photoUrl}
            // Описание для экранного диктора
            alt="Фото после обработки"
            // Обрезка: видна левая часть шириной split %
            style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
          />
          {/* Вертикальная черта-ручка на границе */}
          <span className="compare-handle" style={{ left: `${split}%` }} aria-hidden="true" />
          {/* Подпись слева */}
          <span className="compare-tag left">Фото</span>
          {/* Подпись справа */}
          <span className="compare-tag right">Нити</span>
          {/* Невидимый ползунок поверх всей картины — двигает границу */}
          <input
            // Стиль
            className="compare-range"
            // Тип — ползунок
            type="range"
            // От 0 %
            min={0}
            // До 100 %
            max={100}
            // Текущее положение
            value={split}
            // Описание для экранного диктора
            aria-label="Граница между фото и нитями"
            // Новое положение
            onChange={(e) => setSplit(Number(e.target.value))}
          />
        </div>
      )}

      {/* Режим «на стене» */}
      {mode === "wall" && (
        // Блок
        <div className="wall" data-testid="wall">
          {/* Сцена-комната */}
          <div className="wall-scene">
            {/* Картина нужного видимого размера (не шире сцены) */}
            <div className="wall-art" style={{ width: `min(100%, ${wallPx}px)` }}>
              {/* Картина */}
              {board}
            </div>
          </div>
          {/* Выбор расстояния */}
          <div className="wall-distances segmented-wide" role="radiogroup" aria-label="Расстояние до картины">
            {/* Кнопка на каждое расстояние */}
            {DISTANCES.map((d) => (
              // Кнопка-переключатель
              <button key={d} type="button" role="radio" aria-checked={distance === d} onClick={() => setDistance(d)}>
                {/* «3 м» */}
                {d} м
              </button>
            ))}
          </div>
          {/* Пояснение */}
          <p className="stage-note" data-testid="wall-note">
            {/* Текст пояснения; при крупном показе — подсказка про детали */}
            Так картина {num(diameterCm, diameterCm % 1 ? 1 : 0)} см видна с {distance} м, если экран — на расстоянии
            вытянутой руки.{wallPx > 640 ? " Ближе 1–2 м детали различимы, как на превью." : ""}
          </p>
        </div>
      )}
    </div>
  );
}
