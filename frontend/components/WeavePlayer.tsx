"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAutoAdvance } from "@/hooks/useAutoAdvance";
import { MAX_SPEED_SEC, MIN_SPEED_SEC } from "@/lib/constants";
import { num, seconds } from "@/lib/format";
import { nailLabel } from "@/lib/nails";
import { speak, speechSupported, spokenStep, stopSpeaking, type VoiceMode } from "@/lib/speech";
import { canGoFaster, canGoSlower, clampSpeed, faster, slower } from "@/lib/speed";
import { cumulativeLengthsM } from "@/lib/thread";
import { Board } from "./Board";

export interface WeavePlayerProps {
  sequence: readonly number[];
  totalSteps: number;
  diameterCm: number;
  initialStep: number;
  initialSpeedSec: number;
  onStepChange?: (step: number) => void;
  onSpeedChange?: (sec: number) => void;
}

const VOICE_KEY = "stringart.voice";

function readVoicePrefs(): { enabled: boolean; mode: VoiceMode } {
  try {
    const raw = window.localStorage.getItem(VOICE_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      return { enabled: Boolean(v.enabled), mode: v.mode === "full" ? "full" : "target" };
    }
  } catch {
    /* приватный режим или битые данные — берём значения по умолчанию */
  }
  return { enabled: false, mode: "target" };
}

export function WeavePlayer({
  sequence,
  totalSteps,
  diameterCm,
  initialStep,
  initialSpeedSec,
  onStepChange,
  onSpeedChange,
}: WeavePlayerProps) {
  const clampStep = useCallback((s: number) => Math.min(totalSteps, Math.max(1, Math.round(s))), [totalSteps]);
  const [step, setStep] = useState(() => clampStep(initialStep));
  const [speed, setSpeed] = useState(() => clampSpeed(initialSpeedSec));
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [voice, setVoice] = useState<{ enabled: boolean; mode: VoiceMode }>({ enabled: false, mode: "target" });
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [jump, setJump] = useState("");

  useEffect(() => {
    setVoice(readVoicePrefs());
    setVoiceAvailable(speechSupported());
  }, []);

  const goTo = useCallback(
    (next: number) => {
      const s = clampStep(next);
      setStep(s);
      setFinished(false);
      onStepChange?.(s);
    },
    [clampStep, onStepChange],
  );

  const changeSpeed = useCallback(
    (next: number) => {
      setSpeed(next);
      onSpeedChange?.(next);
    },
    [onSpeedChange],
  );

  useAutoAdvance(playing, speed * 1000, step, () => {
    if (step >= totalSteps) {
      setPlaying(false);
      setFinished(true);
    } else {
      goTo(step + 1);
    }
  });

  // Озвучка: при каждой смене шага и при включении голоса
  const from = sequence[step - 1];
  const to = sequence[step];
  const lastSpoken = useRef<string>("");
  useEffect(() => {
    if (!voice.enabled || from === undefined || to === undefined) return;
    const key = `${step}:${voice.mode}`;
    if (lastSpoken.current === key) return;
    lastSpoken.current = key;
    speak(spokenStep(from, to, voice.mode));
  }, [voice, step, from, to]);
  useEffect(() => () => stopSpeaking(), []);

  const saveVoice = (v: { enabled: boolean; mode: VoiceMode }) => {
    setVoice(v);
    lastSpoken.current = "";
    if (!v.enabled) stopSpeaking();
    try {
      window.localStorage.setItem(VOICE_KEY, JSON.stringify(v));
    } catch {
      /* не критично */
    }
  };

  const togglePlay = useCallback(() => {
    if (finished) return;
    setPlaying((p) => !p);
  }, [finished]);

  // Клавиатура: пробел — старт/пауза, ←/→ — шаг, ↑/↓ — быстрее/медленнее
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight") goTo(step + 1);
      else if (e.key === "ArrowLeft") goTo(step - 1);
      else if (e.key === "ArrowUp") {
        e.preventDefault();
        changeSpeed(faster(speed));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        changeSpeed(slower(speed));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, goTo, step, speed, changeSpeed]);

  const cumulative = useMemo(
    () => cumulativeLengthsM(sequence.slice(0, totalSteps + 1), diameterCm),
    [sequence, totalSteps, diameterCm],
  );
  const percent = (step / totalSteps) * 100;
  const next = step < totalSteps ? sequence[step + 1] : undefined;

  return (
    <div className="weave">
      <section className="weave-main" aria-label="Текущий шаг">
        <div className="weave-progress">
          <div className="weave-count" data-testid="step-counter">
            Шаг <strong>{num(step)}</strong> из {num(totalSteps)}
          </div>
          <div
            className="bar"
            role="progressbar"
            aria-label="Прогресс плетения"
            aria-valuemin={1}
            aria-valuemax={totalSteps}
            aria-valuenow={step}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
        </div>

        <p className="weave-step" data-testid="current-step" aria-live="polite">
          <span className="nail from">{nailLabel(from)}</span>{" "}
          <span className="arrow">→</span>{" "}
          <span className="nail to">{nailLabel(to)}</span>
        </p>

        <p className="weave-hint">
          {finished ? (
            <span data-testid="finished">Готово: все {num(totalSteps)} шагов пройдены. Закрепите леску узлом.</span>
          ) : step === 1 ? (
            "Привяжите леску к гвоздю A1 и нажмите «Старт»."
          ) : next !== undefined ? (
            <>
              Дальше: {nailLabel(to)} → {nailLabel(next)}
            </>
          ) : (
            "Это последний шаг."
          )}
        </p>

        <div className="transport">
          <button type="button" className="btn ghost" onClick={() => goTo(step - 1)} disabled={step <= 1}>
            Назад
          </button>
          <button
            type="button"
            className="btn primary play"
            onClick={togglePlay}
            aria-pressed={playing}
            disabled={finished}
          >
            {playing ? "Пауза" : step > 1 ? "Продолжить" : "Старт"}
          </button>
          <button type="button" className="btn ghost" onClick={() => goTo(step + 1)} disabled={step >= totalSteps}>
            Вперёд
          </button>
        </div>

        <div className="speed" role="group" aria-label="Скорость автоперелистывания">
          <button
            type="button"
            className="btn small"
            onClick={() => changeSpeed(faster(speed))}
            disabled={!canGoFaster(speed)}
            title={`Минимум ${seconds(MIN_SPEED_SEC)}`}
          >
            Быстрее <small>−0,1 с</small>
          </button>
          <output className="speed-value" data-testid="speed">
            {seconds(speed)} на шаг
          </output>
          <button
            type="button"
            className="btn small"
            onClick={() => changeSpeed(slower(speed))}
            disabled={!canGoSlower(speed)}
            title={`Максимум ${seconds(MAX_SPEED_SEC)}`}
          >
            Медленнее <small>+0,1 с</small>
          </button>
        </div>

        <div className="weave-extra">
          <div className="voice">
            <label className="switch">
              <input
                type="checkbox"
                checked={voice.enabled}
                disabled={!voiceAvailable}
                onChange={(e) => saveVoice({ ...voice, enabled: e.target.checked })}
              />
              <span>Озвучивать шаги</span>
            </label>
            <select
              aria-label="Что озвучивать"
              value={voice.mode}
              disabled={!voiceAvailable || !voice.enabled}
              onChange={(e) => saveVoice({ ...voice, mode: e.target.value as VoiceMode })}
            >
              <option value="target">только куда тянуть</option>
              <option value="full">откуда и куда</option>
            </select>
            {!voiceAvailable && <small>Браузер не умеет синтезировать речь.</small>}
          </div>

          <form
            className="jump"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(jump);
              if (Number.isFinite(n) && n >= 1) goTo(n);
              setJump("");
            }}
          >
            <label htmlFor="jump-input">Перейти к шагу</label>
            <input
              id="jump-input"
              type="number"
              inputMode="numeric"
              min={1}
              value={jump}
              onChange={(e) => setJump(e.target.value)}
            />
            <button type="submit" className="btn small">
              Перейти
            </button>
          </form>

          <p className="thread-used" data-testid="thread-used">
            Уже натянуто {num(cumulative[step - 1] ?? 0, 1)} м из {num(cumulative[totalSteps] ?? 0, 1)} м лески
          </p>
          <p className="keys">
            <kbd>Пробел</kbd> старт и пауза, <kbd>←</kbd> <kbd>→</kbd> шаг, <kbd>↑</kbd> <kbd>↓</kbd> быстрее и медленнее
          </p>
        </div>
      </section>

      <aside className="weave-board">
        <Board
          label={`Схема: линия от ${nailLabel(from)} к ${nailLabel(to)}`}
          sequence={sequence}
          lines={step - 1}
          diameterCm={diameterCm}
          activeStep={step}
        />
      </aside>
    </div>
  );
}
