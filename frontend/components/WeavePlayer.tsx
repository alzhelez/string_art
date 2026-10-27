"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAutoAdvance } from "@/hooks/useAutoAdvance";
import { useMusicLibrary, useVideoLibrary } from "@/hooks/useMedia";
import { MAX_SPEED_SEC, MIN_SPEED_SEC } from "@/lib/constants";
import { num, seconds } from "@/lib/format";
import { nailLabel } from "@/lib/nails";
import { chime, DEFAULT_SOUND, readSoundPrefs, saveSoundPrefs, type SoundPrefs, type StepSound } from "@/lib/sound";
import { speak, speechSupported, spokenStep, stopSpeaking, type VoiceMode } from "@/lib/speech";
import { canGoFaster, canGoSlower, clampSpeed, faster, slower } from "@/lib/speed";
import { cumulativeLengthsM } from "@/lib/thread";
import { Board } from "./Board";
import { MediaStage, MusicDock, VideoPanel } from "./Media";
import { NailBadge } from "./NailBadge";
import { Slider, Tabs } from "./ui/Controls";
import { Icon, type IconName } from "./ui/Icon";

export interface WeavePlayerProps {
  sequence: readonly number[];
  totalSteps: number;
  diameterCm: number;
  initialStep: number;
  initialSpeedSec: number;
  /** Название портрета — в верхней строке. */
  title?: string;
  /** Куда ведёт стрелка «назад» (студия портрета). */
  backHref?: string;
  onStepChange?: (step: number) => void;
  onSpeedChange?: (sec: number) => void;
}

const SOUND_OPTIONS: { value: StepSound; label: string; icon: IconName }[] = [
  { value: "none", label: "Без звука", icon: "mute" },
  { value: "chime", label: "Сигнал", icon: "bell" },
  { value: "voice", label: "Голос", icon: "voice" },
];

const TAB_KEY = "stringart.weave.tab";

/** Полноэкранный режим «кино»: сцена с видео на весь экран, шаг — поверх видео. */
function useCinema(target: React.RefObject<HTMLElement | null>) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(document.fullscreenElement === target.current && target.current !== null);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [target]);
  const toggle = useCallback(async () => {
    const el = target.current;
    if (!el) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (on) {
      setOn(false); // запасной режим без Fullscreen API (iPhone)
      return;
    }
    try {
      await el.requestFullscreen({ navigationUI: "hide" });
    } catch {
      setOn(true);
    }
  }, [target, on]);
  return { on, toggle };
}

export function WeavePlayer({
  sequence,
  totalSteps,
  diameterCm,
  initialStep,
  initialSpeedSec,
  title,
  backHref,
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
  const [tab, setTabState] = useState("video");
  const video = useVideoLibrary(playing);
  const music = useMusicLibrary();
  const stageRef = useRef<HTMLElement>(null);
  const cinema = useCinema(stageRef);
  const hasVideo = Boolean(video.current);

  useEffect(() => {
    setSound(readSoundPrefs());
    setVoiceAvailable(speechSupported());
    try {
      const saved = localStorage.getItem(TAB_KEY);
      if (saved) setTabState(saved);
    } catch {
      /* по умолчанию — «Видео» */
    }
  }, []);

  const setTab = (id: string) => {
    setTabState(id);
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch {
      /* не критично */
    }
  };

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

  // Клавиатура: пробел — старт/пауза, ←/→ — шаг, ↑/↓ — быстрее/медленнее, F — кино
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (["INPUT", "SELECT", "TEXTAREA", "VIDEO", "AUDIO"].includes(t.tagName) || t.getAttribute("role") === "tab")) return;
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
      } else if ((e.key === "f" || e.key === "а") && hasVideo) void cinema.toggle();
      else if (e.key === "Escape" && cinema.on && !document.fullscreenElement) void cinema.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, goTo, step, speed, changeSpeed, hasVideo, cinema]);

  const cumulative = useMemo(
    () => cumulativeLengthsM(sequence.slice(0, totalSteps + 1), diameterCm),
    [sequence, totalSteps, diameterCm],
  );
  const percent = (step / totalSteps) * 100;
  const next = step < totalSteps ? sequence[step + 1] : undefined;
  const playLabel = playing ? "Пауза" : step > 1 ? "Продолжить" : "Старт";

  const hint = finished ? (
    <span data-testid="finished">Готово: все {num(totalSteps)} шагов пройдены. Закрепите леску узлом.</span>
  ) : step === 1 ? (
    "Привяжите леску к гвоздю A1 и нажмите «Старт»."
  ) : next !== undefined ? (
    <>
      Дальше: {nailLabel(to)} → {nailLabel(next)}
    </>
  ) : (
    "Это последний шаг."
  );

  const board = (
    <Board
      label={`Схема: линия от ${nailLabel(from)} к ${nailLabel(to)}`}
      sequence={sequence}
      lines={step - 1}
      diameterCm={diameterCm}
      activeStep={step}
    />
  );

  const stepLine = (big: boolean) => (
    <p className={`weave-step ${big ? "" : "is-compact"}`} data-testid={big ? "current-step" : undefined} aria-live={big ? "polite" : undefined} key={step}>
      <NailBadge nail={from} className="from" />
      <svg className="thread" viewBox="0 0 64 12" aria-hidden="true">
        <line x1="2" y1="6" x2="56" y2="6" />
        <path d="M52 1.5 58.5 6 52 10.5" />
      </svg>
      {" "}
      <span className="visually-hidden">→</span>{" "}
      <NailBadge nail={to} className="to" />
    </p>
  );

  return (
    <div className={`weave ${hasVideo ? "has-video" : "no-video"} ${cinema.on ? "is-cinema" : ""}`}>
      <header className="weave-top">
        {backHref && (
          <Link href={backHref} className="weave-back" aria-label="К настройкам портрета" title="К настройкам портрета">
            <Icon name="arrowLeft" size={20} />
          </Link>
        )}
        {title && <span className="weave-title">{title}</span>}
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
        <span className="weave-percent">{num(percent, 1)} %</span>
        <span className="thread-used" data-testid="thread-used">
          Уже натянуто {num(cumulative[step - 1] ?? 0, 1)} м из {num(cumulative[totalSteps] ?? 0, 1)} м лески
        </span>
      </header>

      <section className="weave-stage" ref={stageRef} aria-label={hasVideo ? "Видео" : "Схема"}>
        {hasVideo ? <MediaStage lib={video} /> : <div className="stage-board">{board}</div>}
        {hasVideo && (
          <div className="stage-bar">
            <span className="stage-title">{video.current?.title}</span>
            {video.items.length > 1 && (
              <button type="button" className="btn ghost small on-dark" onClick={video.next} disabled={video.index >= video.items.length - 1}>
                <Icon name="skip" size={16} />
                Следующее
              </button>
            )}
            <button type="button" className="btn ghost small on-dark" onClick={() => void cinema.toggle()} data-testid="cinema-toggle">
              <Icon name={cinema.on ? "shrink" : "expand"} size={16} />
              {cinema.on ? "Выйти из кино" : "Кино: на весь экран с шагами"}
            </button>
          </div>
        )}
        {cinema.on && (
          <div className="cinema-hud" data-testid="cinema-hud">
            <div className="hud-progress">
              <span style={{ width: `${percent}%` }} />
            </div>
            <div className="hud-row">
              {stepLine(false)}
              <span className="hud-count">
                {num(step)} / {num(totalSteps)}
              </span>
              <div className="hud-buttons">
                <button type="button" className="hud-btn" onClick={() => goTo(step - 1)} disabled={step <= 1} aria-label="Назад">
                  <Icon name="prev" size={18} />
                </button>
                <button type="button" className="hud-btn play" onClick={togglePlay} disabled={finished} aria-label={playLabel}>
                  <Icon name={playing ? "pause" : "play"} size={22} />
                </button>
                <button type="button" className="hud-btn" onClick={() => goTo(step + 1)} disabled={step >= totalSteps} aria-label="Вперёд">
                  <Icon name="next" size={18} />
                </button>
                <button type="button" className="hud-btn" onClick={() => void cinema.toggle()} aria-label="Выйти из кино">
                  <Icon name="shrink" size={18} />
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <aside className="weave-rail">
        <section className="step-card" aria-label="Текущий шаг">
          {stepLine(true)}
          <p className="weave-hint">{hint}</p>
          <div className="transport">
            <button type="button" className="round-btn" onClick={() => goTo(step - 1)} disabled={step <= 1} aria-label="Назад" title="Назад (←)">
              <Icon name="prev" size={20} />
            </button>
            <button
              type="button"
              className="round-btn play"
              onClick={togglePlay}
              aria-pressed={playing}
              aria-label={playLabel}
              disabled={finished}
            >
              <Icon name={playing ? "pause" : "play"} size={26} />
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
              <Icon name="next" size={20} />
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
        </section>

        {hasVideo && <div className="rail-board">{board}</div>}
        <MusicDock lib={music} />
      </aside>

      <section className="weave-settings">
        <Tabs
          label="Настройки плетения"
          value={tab}
          onChange={setTab}
          tabs={[
            {
              id: "video",
              title: (
                <>
                  <Icon name="film" size={18} /> Видео
                </>
              ),
              panel: <VideoPanel lib={video} />,
            },
            {
              id: "sound",
              title: (
                <>
                  <Icon name="bell" size={18} /> Сигнал шага
                </>
              ),
              panel: (
                <div className="sound-panel">
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
                </div>
              ),
            },
            {
              id: "jump",
              title: (
                <>
                  <Icon name="skip" size={18} /> Переход
                </>
              ),
              panel: (
                <div className="jump-panel">
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
                    медленнее, <kbd>F</kbd> кино на весь экран
                  </p>
                </div>
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}
