"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActivity } from "@/hooks/useActivity";
import { useAutoAdvance } from "@/hooks/useAutoAdvance";
import { useVoiceControl } from "@/hooks/useVoiceControl";
import type { Activity } from "@/lib/api";
import { keyCommand, type Command } from "@/lib/control";
import { duration, estimate } from "@/lib/eta";
import { nextChange, planSpools } from "@/lib/spool";
import { useMusicLibrary, useVideoLibrary } from "@/hooks/useMedia";
import { MAX_SPEED_SEC, MIN_SPEED_SEC } from "@/lib/constants";
import { num, plural, seconds } from "@/lib/format";
import { nailLabel } from "@/lib/nails";
import { chime, DEFAULT_SOUND, readSoundPrefs, saveSoundPrefs, type SoundPrefs, type StepSound } from "@/lib/sound";
import { speak, speechSupported, spokenStep, stopSpeaking, type VoiceMode } from "@/lib/speech";
import { canGoFaster, canGoSlower, clampSpeed, faster, slower } from "@/lib/speed";
import { cumulativeLengthsM } from "@/lib/thread";
import { Board } from "./Board";
import { MediaStage, MusicDock, VideoPanel } from "./Media";
import { NailBadge } from "./NailBadge";
import { ControlPanel } from "./weave/ControlPanel";
import { TimePanel } from "./weave/TimePanel";
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
  /** Для учёта времени плетения на сервере; без него время не сохраняется. */
  projectId?: string;
  activity?: Activity;
  /** Длина катушки, м: своя или стандартная из расчёта — для плана смены катушек. */
  spoolM?: number;
}

const BREAK_KEY = "stringart.breaks";
const VOICE_KEY = "stringart.voiceControl";
const BREAK_LEN_SEC = 5 * 60;
const SNOOZE_SEC = 15 * 60;
/** За сколько шагов предупреждать о смене катушки. */
const SPOOL_WARN_STEPS = 40;

function readNumber(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : Number(v);
  } catch {
    return fallback;
  }
}

function writeValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* не критично */
  }
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
  projectId,
  activity: initialActivity,
  spoolM,
}: WeavePlayerProps) {
  const clampStep = useCallback((s: number) => Math.min(totalSteps, Math.max(1, Math.round(s))), [totalSteps]);
  const [step, setStep] = useState(() => clampStep(initialStep));
  const [speed, setSpeed] = useState(() => clampSpeed(initialSpeedSec));
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [sound, setSound] = useState<SoundPrefs>(DEFAULT_SOUND);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [tab, setTabState] = useState("video");
  const [voiceOn, setVoiceOnState] = useState(false);
  const [breakMin, setBreakMinState] = useState(60);
  const [breakDue, setBreakDue] = useState(false);
  const [breakLeft, setBreakLeft] = useState(0);
  const nextBreakAt = useRef(60 * 60);
  const video = useVideoLibrary(playing);
  const music = useMusicLibrary();
  const stageRef = useRef<HTMLElement>(null);
  const cinema = useCinema(stageRef);
  const hasVideo = Boolean(video.current);

  useEffect(() => {
    setSound(readSoundPrefs());
    setVoiceAvailable(speechSupported());
    setVoiceOnState(readNumber(VOICE_KEY, 0) === 1);
    const b = readNumber(BREAK_KEY, 60);
    setBreakMinState(b);
    nextBreakAt.current = b * 60;
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

  const repeatStep = useCallback(() => {
    if (from === undefined || to === undefined) return;
    if (speechSupported()) speak(spokenStep(from, to, "full"));
    else chime(sound.volume);
  }, [from, to, sound.volume]);

  /** Одна точка входа для клавиш, кликера, педали и голоса. */
  const run = useCallback(
    (cmd: Command) => {
      if (cmd === "next") goTo(step + 1);
      else if (cmd === "prev") goTo(step - 1);
      else if (cmd === "toggle") togglePlay();
      else if (cmd === "play") !finished && setPlaying(true);
      else if (cmd === "pause") setPlaying(false);
      else if (cmd === "faster") changeSpeed(faster(speed));
      else if (cmd === "slower") changeSpeed(slower(speed));
      else if (cmd === "repeat") repeatStep();
    },
    [goTo, step, togglePlay, finished, changeSpeed, speed, repeatStep],
  );

  // Клавиатура, кликер для презентаций, педаль, медиа-клавиши; F — кино
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (["INPUT", "SELECT", "TEXTAREA", "VIDEO", "AUDIO"].includes(t.tagName) || t.getAttribute("role") === "tab")) return;
      // Пробел/Enter на кнопке — это нажатие самой кнопки, не дублируем
      if (t instanceof HTMLButtonElement && (e.key === " " || e.key === "Enter")) return;
      if ((e.key === "f" || e.key === "а") && hasVideo) {
        void cinema.toggle();
        return;
      }
      if (e.key === "Escape" && cinema.on && !document.fullscreenElement) {
        void cinema.toggle();
        return;
      }
      const cmd = keyCommand(e);
      if (!cmd) return;
      e.preventDefault();
      run(cmd);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, hasVideo, cinema]);

  // Голос
  const setVoiceOn = (v: boolean) => {
    setVoiceOnState(v);
    writeValue(VOICE_KEY, v ? "1" : "0");
  };
  const voice = useVoiceControl(voiceOn, (cmd) => run(cmd));

  // Время плетения, прогноз и перерывы
  const { activity, sessionSec, resetSession } = useActivity(projectId, step, playing, initialActivity);
  const eta = useMemo(() => estimate(activity, speed, step, totalSteps), [activity, speed, step, totalSteps]);
  const setBreakMin = (m: number) => {
    setBreakMinState(m);
    writeValue(BREAK_KEY, String(m));
    nextBreakAt.current = sessionSec + m * 60;
  };
  useEffect(() => {
    if (sessionSec === 0) nextBreakAt.current = breakMin * 60;
    if (breakMin > 0 && !breakDue && breakLeft === 0 && sessionSec >= nextBreakAt.current && sessionSec > 0) {
      setBreakDue(true);
      chime(Math.max(0.4, sound.volume));
    }
  }, [sessionSec, breakMin, breakDue, breakLeft, sound.volume]);
  // Перерыв считается от времени окончания, а не тиками: сворачивание вкладки его не растягивает
  const breakEnd = useRef(0);
  const breaking = breakLeft > 0;
  useEffect(() => {
    if (!breaking) return;
    const t = setInterval(() => {
      const left = Math.max(0, Math.ceil((breakEnd.current - Date.now()) / 1000));
      setBreakLeft(left);
      if (left === 0) {
        chime(Math.max(0.4, sound.volume));
        resetSession();
        nextBreakAt.current = breakMin * 60;
      }
    }, 1000);
    return () => clearInterval(t);
  }, [breaking, breakMin, resetSession, sound.volume]);
  const startBreak = () => {
    setPlaying(false);
    setBreakDue(false);
    breakEnd.current = Date.now() + BREAK_LEN_SEC * 1000;
    setBreakLeft(BREAK_LEN_SEC);
  };
  const snoozeBreak = () => {
    setBreakDue(false);
    nextBreakAt.current = sessionSec + SNOOZE_SEC;
  };

  // Смена катушки
  const spoolPlan = useMemo(
    () => (spoolM ? planSpools(sequence, totalSteps, diameterCm, spoolM) : { changes: [], spools: 1 }),
    [sequence, totalSteps, diameterCm, spoolM],
  );
  const change = nextChange(spoolPlan.changes, step);
  const spoolAlert =
    change && change.afterStep - step <= SPOOL_WARN_STEPS ? (
      <p className={`spool-alert ${change.afterStep === step ? "is-now" : ""}`} data-testid="spool-alert" role="status">
        {change.afterStep === step ? (
          <>
            Катушка №{change.spool} кончается: дотяните нить до <strong>{change.label}</strong>, завяжите узел и
            продолжайте новой катушкой с этого гвоздя.
          </>
        ) : (
          <>
            Через {num(change.afterStep - step)} {plural(change.afterStep - step, ["шаг", "шага", "шагов"])} смена
            катушки: после шага {num(change.afterStep)} узел на гвозде <strong>{change.label}</strong>.
          </>
        )}
      </p>
    ) : null;

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
        <span className="weave-eta" data-testid="eta" title="По вашему темпу плетения">
          <Icon name="clock" size={16} />
          {finished ? "готово" : `≈ ${duration(eta.remainingSec)}`}
        </span>
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
          {spoolAlert}
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
              id: "control",
              title: (
                <>
                  <Icon name="voice" size={18} /> Управление
                </>
              ),
              panel: (
                <ControlPanel
                  voiceOn={voiceOn}
                  setVoiceOn={setVoiceOn}
                  voiceStatus={voice.status}
                  heard={voice.heard}
                  onJump={goTo}
                />
              ),
            },
            {
              id: "time",
              title: (
                <>
                  <Icon name="clock" size={18} /> Время
                </>
              ),
              panel: <TimePanel eta={eta} activity={activity} breakMin={breakMin} setBreakMin={setBreakMin} />,
            },
          ]}
        />
      </section>
      {(breakDue || breakLeft > 0) && (
        <div className="break-toast" role="status" data-testid="break-toast">
          {breakLeft > 0 ? (
            <>
              <strong>Перерыв: {Math.floor(breakLeft / 60)}:{String(breakLeft % 60).padStart(2, "0")}</strong>
              <span>Встаньте, разомните кисти и плечи, посмотрите вдаль. Сигнал позовёт обратно.</span>
              <button type="button" className="btn secondary small" onClick={() => setBreakLeft(0)}>
                Вернуться раньше
              </button>
            </>
          ) : (
            <>
              <strong>Вы плетёте уже {duration(sessionSec)}</strong>
              <span>Пора размять руки и дать отдохнуть глазам.</span>
              <div className="break-actions">
                <button type="button" className="btn primary small" onClick={startBreak}>
                  Перерыв 5 минут
                </button>
                <button type="button" className="btn ghost small" onClick={snoozeBreak}>
                  Ещё 15 минут
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
