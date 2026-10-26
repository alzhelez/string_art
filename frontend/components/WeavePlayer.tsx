"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAutoAdvance } from "@/hooks/useAutoAdvance";
import { MAX_SPEED_SEC, MIN_SPEED_SEC } from "@/lib/constants";
import { num, seconds } from "@/lib/format";
import { nailLabel } from "@/lib/nails";
import { chime, DEFAULT_SOUND, readSoundPrefs, saveSoundPrefs, type SoundPrefs, type StepSound } from "@/lib/sound";
import { speak, speechSupported, spokenStep, stopSpeaking, type VoiceMode } from "@/lib/speech";
import { canGoFaster, canGoSlower, clampSpeed, faster, slower } from "@/lib/speed";
import { cumulativeLengthsM } from "@/lib/thread";
import { Board } from "./Board";
import { MediaPanel } from "./MediaPanel";
import { Section, Slider } from "./ui/Controls";
import { Icon, type IconName } from "./ui/Icon";

export interface WeavePlayerProps {
  sequence: readonly number[];
  totalSteps: number;
  diameterCm: number;
  initialStep: number;
  initialSpeedSec: number;
  onStepChange?: (step: number) => void;
  onSpeedChange?: (sec: number) => void;
}

const SOUND_OPTIONS: { value: StepSound; label: string; icon: IconName }[] = [
  { value: "none", label: "Без звука", icon: "mute" },
  { value: "chime", label: "Сигнал", icon: "bell" },
  { value: "voice", label: "Голос", icon: "voice" },
];

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
  const [sound, setSound] = useState<SoundPrefs>(DEFAULT_SOUND);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [jump, setJump] = useState("");

  useEffect(() => {
    setSound(readSoundPrefs());
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

  // Звук шага: при смене шага (и при включении голоса — сразу текущий шаг)
  const from = sequence[step - 1];
  const to = sequence[step];
  const lastSounded = useRef<string>(`${step}:init`);
  useEffect(() => {
    if (from === undefined || to === undefined) return;
    const key = `${step}:${sound.kind}:${sound.voiceMode}`;
    if (lastSounded.current === key) return;
    const firstRender = lastSounded.current.endsWith(":init");
    lastSounded.current = key;
    if (sound.kind === "voice") speak(spokenStep(from, to, sound.voiceMode));
    else if (sound.kind === "chime" && !firstRender) chime(sound.volume);
  }, [sound, step, from, to]);
  useEffect(() => () => stopSpeaking(), []);

  const updateSound = (p: SoundPrefs) => {
    setSound(p);
    if (p.kind !== "voice") stopSpeaking();
    saveSoundPrefs(p);
  };

  const togglePlay = useCallback(() => {
    if (finished) return;
    setPlaying((p) => !p);
  }, [finished]);

  // Клавиатура: пробел — старт/пауза, ←/→ — шаг, ↑/↓ — быстрее/медленнее
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.tagName === "VIDEO" || t.tagName === "AUDIO")) return;
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
  const playLabel = playing ? "Пауза" : step > 1 ? "Продолжить" : "Старт";

  return (
    <div className="weave">
      <section className="weave-main" aria-label="Текущий шаг">
        <div className="weave-progress">
          <div className="weave-count" data-testid="step-counter">
            Шаг <strong>{num(step)}</strong> из {num(totalSteps)}
          </div>
          <span className="weave-percent">{num(percent, 1)} %</span>
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

        <p className="weave-step" data-testid="current-step" aria-live="polite" key={step}>
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
          <button type="button" className="round-btn" onClick={() => goTo(step - 1)} disabled={step <= 1} aria-label="Назад" title="Назад (←)">
            <Icon name="prev" size={22} />
          </button>
          <button
            type="button"
            className="round-btn play"
            onClick={togglePlay}
            aria-pressed={playing}
            aria-label={playLabel}
            disabled={finished}
          >
            <Icon name={playing ? "pause" : "play"} size={30} />
            <span className="play-text" aria-hidden="true">
              {playLabel}
            </span>
          </button>
          <button
            type="button"
            className="round-btn"
            onClick={() => goTo(step + 1)}
            disabled={step >= totalSteps}
            aria-label="Вперёд"
            title="Вперёд (→)"
          >
            <Icon name="next" size={22} />
          </button>
        </div>

        <div className="speed" role="group" aria-label="Скорость автоперелистывания">
          <button
            type="button"
            className="icon-btn"
            onClick={() => changeSpeed(faster(speed))}
            disabled={!canGoFaster(speed)}
            aria-label="Быстрее на 0,1 с"
            title={`Быстрее (↑), минимум ${seconds(MIN_SPEED_SEC)}`}
          >
            <Icon name="minus" />
          </button>
          <output className="speed-value" data-testid="speed">
            {seconds(speed)} на шаг
          </output>
          <button
            type="button"
            className="icon-btn"
            onClick={() => changeSpeed(slower(speed))}
            disabled={!canGoSlower(speed)}
            aria-label="Медленнее на 0,1 с"
            title={`Медленнее (↓), максимум ${seconds(MAX_SPEED_SEC)}`}
          >
            <Icon name="plus" />
          </button>
        </div>

        <p className="thread-used" data-testid="thread-used">
          Уже натянуто {num(cumulative[step - 1] ?? 0, 1)} м из {num(cumulative[totalSteps] ?? 0, 1)} м лески
        </p>
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

      <div className="weave-extras">
        <Section title="Сигнал шага">
          <div className="segmented-wide" role="radiogroup" aria-label="Сигнал шага">
            {SOUND_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={sound.kind === o.value}
                disabled={o.value === "voice" && !voiceAvailable}
                onClick={() => updateSound({ ...sound, kind: o.value })}
              >
                <Icon name={o.icon} size={18} />
                {o.label}
              </button>
            ))}
          </div>
          {sound.kind === "voice" && (
            <label className="inline-field">
              <span>Произносить</span>
              <select
                aria-label="Что озвучивать"
                value={sound.voiceMode}
                onChange={(e) => updateSound({ ...sound, voiceMode: e.target.value as VoiceMode })}
              >
                <option value="target">только куда тянуть</option>
                <option value="full">откуда и куда</option>
              </select>
            </label>
          )}
          {sound.kind === "chime" && (
            <Slider
              id="chime-volume"
              label="Громкость сигнала"
              min={0.1}
              max={1}
              step={0.05}
              value={sound.volume}
              display={`${num(Math.round(sound.volume * 100))} %`}
              onChange={(v) => updateSound({ ...sound, volume: v })}
            />
          )}
          {!voiceAvailable && <small className="muted">Голос недоступен: браузер не умеет синтезировать речь.</small>}
        </Section>

        <Section title="Фильм или музыка">
          <MediaPanel weavePlaying={playing} />
        </Section>

        <Section title="Навигация">
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
            <button type="submit" className="btn secondary small">
              Перейти
            </button>
          </form>
          <p className="keys">
            <kbd>Пробел</kbd> старт и пауза, <kbd>←</kbd> <kbd>→</kbd> шаг, <kbd>↑</kbd> <kbd>↓</kbd> быстрее и
            медленнее
          </p>
        </Section>
      </div>
    </div>
  );
}
