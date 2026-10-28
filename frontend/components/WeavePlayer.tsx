// Компонент работает в браузере
"use client";

// Ссылка Next.js
import Link from "next/link";
// Хуки React
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// Учёт времени плетения
import { useActivity } from "@/hooks/useActivity";
// Автоперелистывание
import { useAutoAdvance } from "@/hooks/useAutoAdvance";
// Голосовое управление
import { useVoiceControl } from "@/hooks/useVoiceControl";
// Тип журнала времени
import type { Activity } from "@/lib/api";
// Разбор клавиш и тип команды
import { keyCommand, type Command } from "@/lib/control";
// Длительность словами и прогноз
import { duration, estimate } from "@/lib/eta";
// План смен катушек
import { nextChange, planSpools } from "@/lib/spool";
// Библиотеки видео и музыки
import { useMusicLibrary, useVideoLibrary } from "@/hooks/useMedia";
// Пределы скорости
import { MAX_SPEED_SEC, MIN_SPEED_SEC } from "@/lib/constants";
// Форматирование чисел
import { num, plural, seconds } from "@/lib/format";
// Метка гвоздя
import { nailLabel } from "@/lib/nails";
// Звук шага: сигнал, настройки по умолчанию, чтение и сохранение настроек
import { chime, DEFAULT_SOUND, readSoundPrefs, saveSoundPrefs, type SoundPrefs, type StepSound } from "@/lib/sound";
// Озвучка голосом
import { speak, speechSupported, spokenStep, stopSpeaking, type VoiceMode } from "@/lib/speech";
// Изменение скорости
import { canGoFaster, canGoSlower, clampSpeed, faster, slower } from "@/lib/speed";
// Накопленная длина лески
import { cumulativeLengthsM } from "@/lib/thread";
// Картина
import { Board } from "./Board";
// Плеер, музыкальная панель, вкладка «Видео»
import { MediaStage, MusicDock, VideoPanel } from "./Media";
// Номер гвоздя с «компасом»
import { NailBadge } from "./NailBadge";
// Вкладка «Управление»
import { ControlPanel } from "./weave/ControlPanel";
// Вкладка «Время»
import { TimePanel } from "./weave/TimePanel";
// Ползунок и вкладки
import { Slider, Tabs } from "./ui/Controls";
// Иконки
import { Icon, type IconName } from "./ui/Icon";

// Свойства экрана плетения
export interface WeavePlayerProps {
  // Последовательность гвоздей
  sequence: readonly number[];
  // Сколько шагов (выбранное число линий)
  totalSteps: number;
  // Диаметр
  diameterCm: number;
  // С какого шага начать
  initialStep: number;
  // Скорость автоперелистывания
  initialSpeedSec: number;
  /** Название портрета — в верхней строке. */
  title?: string;
  /** Куда ведёт стрелка «назад» (студия портрета). */
  backHref?: string;
  // Сообщить о смене шага (сохранение прогресса)
  onStepChange?: (step: number) => void;
  // Сообщить о смене скорости
  onSpeedChange?: (sec: number) => void;
  /** Для учёта времени плетения на сервере; без него время не сохраняется. */
  projectId?: string;
  // Журнал времени из проекта
  activity?: Activity;
  /** Длина катушки, м: своя или стандартная из расчёта — для плана смены катушек. */
  spoolM?: number;
}

// Ключ интервала напоминания о перерыве
const BREAK_KEY = "stringart.breaks";
// Ключ «голосовые команды включены»
const VOICE_KEY = "stringart.voiceControl";
// Длина перерыва — 5 минут
const BREAK_LEN_SEC = 5 * 60;
// «Ещё 15 минут» откладывает напоминание
const SNOOZE_SEC = 15 * 60;
/** За сколько шагов предупреждать о смене катушки. */
// Порог предупреждения о катушке
const SPOOL_WARN_STEPS = 40;

// Прочитать число из localStorage
function readNumber(key: string, fallback: number): number {
  // Хранилище может быть недоступно
  try {
    // Значение
    const v = localStorage.getItem(key);
    // Нет — значение по умолчанию
    return v === null ? fallback : Number(v);
  // Ошибка
  } catch {
    // Значение по умолчанию
    return fallback;
  }
}

// Записать значение в localStorage
function writeValue(key: string, value: string): void {
  // Хранилище может быть недоступно
  try {
    // Запись
    localStorage.setItem(key, value);
  // Ошибка
  } catch {
    /* не критично */
  }
}

// Варианты звука шага
const SOUND_OPTIONS: { value: StepSound; label: string; icon: IconName }[] = [
  // Без звука
  { value: "none", label: "Без звука", icon: "mute" },
  // Сигнал
  { value: "chime", label: "Сигнал", icon: "bell" },
  // Голос
  { value: "voice", label: "Голос", icon: "voice" },
];

// Ключ последней открытой вкладки
const TAB_KEY = "stringart.weave.tab";

/** Полноэкранный режим «кино»: сцена с видео на весь экран, шаг — поверх видео. */
// Хук полноэкранного режима «кино»
function useCinema(target: React.RefObject<HTMLElement | null>) {
  // Включён ли
  const [on, setOn] = useState(false);
  // Следим за полноэкранным режимом
  useEffect(() => {
    // Включён, если на весь экран развёрнута наша сцена
    const sync = () => setOn(document.fullscreenElement === target.current && target.current !== null);
    // Подписка на смену режима
    document.addEventListener("fullscreenchange", sync);
    // Отписка
    return () => document.removeEventListener("fullscreenchange", sync);
  // При смене цели
  }, [target]);
  // Переключить кино
  const toggle = useCallback(async () => {
    // Сцена
    const el = target.current;
    // Нет — выход
    if (!el) return;
    // Уже на весь экран
    if (document.fullscreenElement) {
      // Выйти
      await document.exitFullscreen().catch(() => undefined);
      // Готово
      return;
    }
    // Запасной режим включён
    if (on) {
      // Выключить
      setOn(false); // запасной режим без Fullscreen API (iPhone)
      // Готово
      return;
    }
    // Просим браузер развернуть сцену
    try {
      // Без панели навигации браузера (на телефоне)
      await el.requestFullscreen({ navigationUI: "hide" });
    // Не поддерживается (iPhone)
    } catch {
      // Запасной режим: просто растягиваем сцену стилями
      setOn(true);
    }
  // Зависимости
  }, [target, on]);
  // Наружу
  return { on, toggle };
}

// Экран плетения
export function WeavePlayer({
  // Последовательность
  sequence,
  // Шагов
  totalSteps,
  // Диаметр
  diameterCm,
  // Начальный шаг
  initialStep,
  // Начальная скорость
  initialSpeedSec,
  // Название
  title,
  // Ссылка «назад»
  backHref,
  // Обработчик шага
  onStepChange,
  // Обработчик скорости
  onSpeedChange,
  // id проекта
  projectId,
  // Журнал (переименован, чтобы не путать с актуальным)
  activity: initialActivity,
  // Длина катушки
  spoolM,
// Тип свойств
}: WeavePlayerProps) {
  // Ограничить шаг пределами 1…totalSteps
  const clampStep = useCallback((s: number) => Math.min(totalSteps, Math.max(1, Math.round(s))), [totalSteps]);
  // Текущий шаг
  const [step, setStep] = useState(() => clampStep(initialStep));
  // Скорость
  const [speed, setSpeed] = useState(() => clampSpeed(initialSpeedSec));
  // Идёт автоперелистывание
  const [playing, setPlaying] = useState(false);
  // Все шаги пройдены
  const [finished, setFinished] = useState(false);
  // Настройки звука
  const [sound, setSound] = useState<SoundPrefs>(DEFAULT_SOUND);
  // Есть ли синтез речи
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  // Открытая вкладка
  const [tab, setTabState] = useState("video");
  // Голосовые команды включены
  const [voiceOn, setVoiceOnState] = useState(false);
  // Интервал напоминания о перерыве, мин
  const [breakMin, setBreakMinState] = useState(60);
  // Пора на перерыв (показан тост)
  const [breakDue, setBreakDue] = useState(false);
  // Сколько секунд перерыва осталось
  const [breakLeft, setBreakLeft] = useState(0);
  // На какой секунде непрерывной работы напомнить
  const nextBreakAt = useRef(60 * 60);
  // Видео (пауза вместе с плетением)
  const video = useVideoLibrary(playing);
  // Музыка
  const music = useMusicLibrary();
  // Сцена — разворачивается в кино
  const stageRef = useRef<HTMLElement>(null);
  // Кино
  const cinema = useCinema(stageRef);
  // Есть ли видео
  const hasVideo = Boolean(video.current);

  // При открытии — читаем сохранённые настройки
  useEffect(() => {
    // Звук
    setSound(readSoundPrefs());
    // Синтез речи
    setVoiceAvailable(speechSupported());
    // Голосовые команды
    setVoiceOnState(readNumber(VOICE_KEY, 0) === 1);
    // Интервал перерыва
    const b = readNumber(BREAK_KEY, 60);
    // В состояние
    setBreakMinState(b);
    // Первое напоминание
    nextBreakAt.current = b * 60;
    // Хранилище может быть недоступно
    try {
      // Последняя вкладка
      const saved = localStorage.getItem(TAB_KEY);
      // Если была — открываем
      if (saved) setTabState(saved);
    // Ошибка
    } catch {
      /* по умолчанию — «Видео» */
    }
  // Один раз
  }, []);

  // Сменить вкладку
  const setTab = (id: string) => {
    // В состояние
    setTabState(id);
    // Сохранить
    try {
      // Запись
      localStorage.setItem(TAB_KEY, id);
    // Ошибка
    } catch {
      /* не критично */
    }
  };

  // Перейти к шагу
  const goTo = useCallback(
    // Номер шага
    (next: number) => {
      // В пределах
      const s = clampStep(next);
      // Новый шаг
      setStep(s);
      // Уже не «готово»
      setFinished(false);
      // Сообщить (сохранится на сервере)
      onStepChange?.(s);
    },
    // Зависимости
    [clampStep, onStepChange],
  );

  // Сменить скорость
  const changeSpeed = useCallback(
    // Новая скорость
    (next: number) => {
      // В состояние
      setSpeed(next);
      // Сообщить
      onSpeedChange?.(next);
    },
    // Зависимости
    [onSpeedChange],
  );

  // Автоперелистывание: каждые speed секунд
  useAutoAdvance(playing, speed * 1000, step, () => {
    // Последний шаг
    if (step >= totalSteps) {
      // Остановиться
      setPlaying(false);
      // Готово
      setFinished(true);
    // Иначе
    } else {
      // Следующий шаг
      goTo(step + 1);
    }
  });

  // Звук шага: при смене шага (и при включении голоса — сразу текущий шаг)
  // Откуда тянуть
  const from = sequence[step - 1];
  // Куда тянуть
  const to = sequence[step];
  // Что уже озвучено (чтобы не повторять)
  const lastSounded = useRef<string>(`${step}:init`);
  // Звук при смене шага
  useEffect(() => {
    // За пределами — ничего
    if (from === undefined || to === undefined) return;
    // Ключ: шаг + настройки звука
    const key = `${step}:${sound.kind}:${sound.voiceMode}`;
    // Уже озвучивали
    if (lastSounded.current === key) return;
    // Первый показ страницы (сигнал не нужен — шаг не менялся)
    const firstRender = lastSounded.current.endsWith(":init");
    // Запоминаем
    lastSounded.current = key;
    // Голос — всегда
    if (sound.kind === "voice") speak(spokenStep(from, to, sound.voiceMode));
    // Сигнал — кроме первого показа
    else if (sound.kind === "chime" && !firstRender) chime(sound.volume);
  // Зависимости
  }, [sound, step, from, to]);
  // При уходе — замолчать
  useEffect(() => () => stopSpeaking(), []);

  // Изменить настройки звука
  const updateSound = (p: SoundPrefs) => {
    // В состояние
    setSound(p);
    // Голос выключили — замолчать
    if (p.kind !== "voice") stopSpeaking();
    // Сохранить
    saveSoundPrefs(p);
  };

  // Пауза/продолжить
  const togglePlay = useCallback(() => {
    // Всё пройдено — ничего
    if (finished) return;
    // Переключить
    setPlaying((p) => !p);
  // Зависимости
  }, [finished]);

  // Повторить текущий шаг вслух
  const repeatStep = useCallback(() => {
    // Нет шага
    if (from === undefined || to === undefined) return;
    // Голосом (откуда и куда), если умеет браузер
    if (speechSupported()) speak(spokenStep(from, to, "full"));
    // Иначе — сигнал
    else chime(sound.volume);
  // Зависимости
  }, [from, to, sound.volume]);

  /** Одна точка входа для клавиш, кликера, педали и голоса. */
  // Выполнить команду
  const run = useCallback(
    // Команда
    (cmd: Command) => {
      // Вперёд
      if (cmd === "next") goTo(step + 1);
      // Назад
      else if (cmd === "prev") goTo(step - 1);
      // Пауза/продолжить
      else if (cmd === "toggle") togglePlay();
      // Старт (если не всё пройдено)
      else if (cmd === "play") !finished && setPlaying(true);
      // Пауза
      else if (cmd === "pause") setPlaying(false);
      // Быстрее
      else if (cmd === "faster") changeSpeed(faster(speed));
      // Медленнее
      else if (cmd === "slower") changeSpeed(slower(speed));
      // Повторить
      else if (cmd === "repeat") repeatStep();
    },
    // Зависимости
    [goTo, step, togglePlay, finished, changeSpeed, speed, repeatStep],
  );

  // Клавиатура, кликер для презентаций, педаль, медиа-клавиши; F — кино
  // Подписка на клавиатуру
  useEffect(() => {
    // Нажатие
    const onKey = (e: KeyboardEvent) => {
      // Где нажали
      const t = e.target;
      // В полях ввода, плеерах и на вкладках клавиши — их собственные
      if (t instanceof HTMLElement && (["INPUT", "SELECT", "TEXTAREA", "VIDEO", "AUDIO"].includes(t.tagName) || t.getAttribute("role") === "tab")) return;
      // Пробел/Enter на кнопке — это нажатие самой кнопки, не дублируем
      // На кнопке пробел и Enter нажимают саму кнопку
      if (t instanceof HTMLButtonElement && (e.key === " " || e.key === "Enter")) return;
      // F (или «а» в русской раскладке) — кино, если есть видео
      if ((e.key === "f" || e.key === "а") && hasVideo) {
        // Переключить
        void cinema.toggle();
        // Выход
        return;
      }
      // Escape в запасном режиме кино (в полноэкранном его обрабатывает браузер)
      if (e.key === "Escape" && cinema.on && !document.fullscreenElement) {
        // Выйти
        void cinema.toggle();
        // Выход
        return;
      }
      // Клавиша → команда
      const cmd = keyCommand(e);
      // Не наша
      if (!cmd) return;
      // Не прокручивать страницу и т. п.
      e.preventDefault();
      // Выполнить
      run(cmd);
    };
    // Подписка
    window.addEventListener("keydown", onKey);
    // Отписка
    return () => window.removeEventListener("keydown", onKey);
  // Зависимости
  }, [run, hasVideo, cinema]);

  // Голос
  // Включить/выключить голосовые команды
  const setVoiceOn = (v: boolean) => {
    // В состояние
    setVoiceOnState(v);
    // Сохранить
    writeValue(VOICE_KEY, v ? "1" : "0");
  };
  // Распознавание речи; команды идут в run
  const voice = useVoiceControl(voiceOn, (cmd) => run(cmd));

  // Время плетения, прогноз и перерывы
  // Учёт времени: журнал, непрерывная работа, сброс
  const { activity, sessionSec, resetSession } = useActivity(projectId, step, playing, initialActivity);
  // Прогноз окончания (пересчитывается при изменениях)
  const eta = useMemo(() => estimate(activity, speed, step, totalSteps), [activity, speed, step, totalSteps]);
  // Сменить интервал перерыва
  const setBreakMin = (m: number) => {
    // В состояние
    setBreakMinState(m);
    // Сохранить
    writeValue(BREAK_KEY, String(m));
    // Следующее напоминание — через m минут от текущего момента
    nextBreakAt.current = sessionSec + m * 60;
  };
  // Проверка «пора на перерыв» каждую секунду работы
  useEffect(() => {
    // Человек отдохнул — напоминание снова через полный интервал
    if (sessionSec === 0) nextBreakAt.current = breakMin * 60;
    // Напоминания включены, тост ещё не показан, перерыв не идёт и время пришло
    if (breakMin > 0 && !breakDue && breakLeft === 0 && sessionSec >= nextBreakAt.current && sessionSec > 0) {
      // Показать тост
      setBreakDue(true);
      // Сигнал (не тише 40 %)
      chime(Math.max(0.4, sound.volume));
    }
  // Зависимости
  }, [sessionSec, breakMin, breakDue, breakLeft, sound.volume]);
  // Перерыв считается от времени окончания, а не тиками: сворачивание вкладки его не растягивает
  const breakEnd = useRef(0);
  // Идёт ли перерыв
  const breaking = breakLeft > 0;
  // Обратный отсчёт перерыва
  useEffect(() => {
    // Не идёт — ничего
    if (!breaking) return;
    // Раз в секунду
    const t = setInterval(() => {
      // Сколько осталось по часам
      const left = Math.max(0, Math.ceil((breakEnd.current - Date.now()) / 1000));
      // Показываем
      setBreakLeft(left);
      // Перерыв кончился
      if (left === 0) {
        // Сигнал
        chime(Math.max(0.4, sound.volume));
        // Непрерывная работа начинается заново
        resetSession();
        // Следующее напоминание — через полный интервал
        nextBreakAt.current = breakMin * 60;
      }
    // Интервал 1 с
    }, 1000);
    // Остановить
    return () => clearInterval(t);
  // Зависимости
  }, [breaking, breakMin, resetSession, sound.volume]);
  // «Перерыв 5 минут»
  const startBreak = () => {
    // Пауза плетения
    setPlaying(false);
    // Скрыть тост
    setBreakDue(false);
    // Когда закончится
    breakEnd.current = Date.now() + BREAK_LEN_SEC * 1000;
    // Сколько осталось
    setBreakLeft(BREAK_LEN_SEC);
  };
  // «Ещё 15 минут»
  const snoozeBreak = () => {
    // Скрыть тост
    setBreakDue(false);
    // Напомнить через 15 минут
    nextBreakAt.current = sessionSec + SNOOZE_SEC;
  };

  // Смена катушки
  // План смен катушек (пересчитывается только при смене данных)
  const spoolPlan = useMemo(
    // Если длина катушки известна — план, иначе — без смен
    () => (spoolM ? planSpools(sequence, totalSteps, diameterCm, spoolM) : { changes: [], spools: 1 }),
    // Зависимости
    [sequence, totalSteps, diameterCm, spoolM],
  );
  // Ближайшая смена
  const change = nextChange(spoolPlan.changes, step);
  // Предупреждение о смене катушки
  const spoolAlert =
    // Есть смена в пределах 40 шагов?
    change && change.afterStep - step <= SPOOL_WARN_STEPS ? (
      // Абзац; на самом шаге смены — выделенный
      <p className={`spool-alert ${change.afterStep === step ? "is-now" : ""}`} data-testid="spool-alert" role="status">
        {/* Смена прямо сейчас или скоро */}
        {change.afterStep === step ? (
          // Фрагмент
          <>
            {/* Что делать сейчас */}
            Катушка №{change.spool} кончается: дотяните нить до <strong>{change.label}</strong>, завяжите узел и
            продолжайте новой катушкой с этого гвоздя.
          </>
        // Иначе
        ) : (
          // Фрагмент
          <>
            {/* Через сколько шагов и где узел */}
            Через {num(change.afterStep - step)} {plural(change.afterStep - step, ["шаг", "шага", "шагов"])} смена
            катушки: после шага {num(change.afterStep)} узел на гвозде <strong>{change.label}</strong>.
          </>
        )}
      </p>
      // Иначе — ничего
    ) : null;

  // Накопленная длина лески по шагам
  const cumulative = useMemo(
    // Для выбранного числа линий
    () => cumulativeLengthsM(sequence.slice(0, totalSteps + 1), diameterCm),
    // Зависимости
    [sequence, totalSteps, diameterCm],
  );
  // Прогресс в процентах
  const percent = (step / totalSteps) * 100;
  // Следующий гвоздь после текущего шага
  const next = step < totalSteps ? sequence[step + 1] : undefined;
  // Надпись главной кнопки
  const playLabel = playing ? "Пауза" : step > 1 ? "Продолжить" : "Старт";

  // Подсказка под шагом
  const hint = finished ? (
    // Готово
    <span data-testid="finished">Готово: все {num(totalSteps)} шагов пройдены. Закрепите леску узлом.</span>
  // Первый шаг
  ) : step === 1 ? (
    // Подсказка про старт
    "Привяжите леску к гвоздю A1 и нажмите «Старт»."
  // Есть следующий шаг
  ) : next !== undefined ? (
    // Фрагмент
    <>
      {/* «Дальше: C37 → A12» */}
      Дальше: {nailLabel(to)} → {nailLabel(next)}
    </>
  // Иначе
  ) : (
    // Последний шаг
    "Это последний шаг."
  );

  // Картина со схемой (используется в двух местах)
  const board = (
    // Картина
    <Board
      // Описание для экранного диктора
      label={`Схема: линия от ${nailLabel(from)} к ${nailLabel(to)}`}
      // Последовательность
      sequence={sequence}
      // Натянуто линий
      lines={step - 1}
      // Диаметр
      diameterCm={diameterCm}
      // Текущий шаг — выделить
      activeStep={step}
    />
  );

  // Строка шага «откуда → куда» (крупная и компактная)
  const stepLine = (big: boolean) => (
    // Абзац; крупная озвучивается диктором; key — анимация при смене шага
    <p className={`weave-step ${big ? "" : "is-compact"}`} data-testid={big ? "current-step" : undefined} aria-live={big ? "polite" : undefined} key={step}>
      {/* Откуда */}
      <NailBadge nail={from} className="from" />
      {/* Стрелка-нить */}
      <svg className="thread" viewBox="0 0 64 12" aria-hidden="true">
        {/* Линия */}
        <line x1="2" y1="6" x2="56" y2="6" />
        {/* Наконечник */}
        <path d="M52 1.5 58.5 6 52 10.5" />
      </svg>
      {/* Пробел */}
      {" "}
      {/* Стрелка для экранного диктора */}
      <span className="visually-hidden">→</span>{" "}
      {/* Куда */}
      <NailBadge nail={to} className="to" />
    </p>
  );

  // Разметка
  return (
    // Экран плетения; классы — есть ли видео и режим кино
    <div className={`weave ${hasVideo ? "has-video" : "no-video"} ${cinema.on ? "is-cinema" : ""}`}>
      {/* Верхняя строка */}
      <header className="weave-top">
        {/* Ссылка «назад» */}
        {backHref && (
          // Ссылка
          <Link href={backHref} className="weave-back" aria-label="К настройкам портрета" title="К настройкам портрета">
            {/* Стрелка */}
            <Icon name="arrowLeft" size={20} />
          </Link>
        )}
        {/* Название */}
        {title && <span className="weave-title">{title}</span>}
        {/* «Шаг N из M» */}
        <div className="weave-count" data-testid="step-counter">
          {/* Текст */}
          Шаг <strong>{num(step)}</strong> из {num(totalSteps)}
        </div>
        {/* Полоса прогресса */}
        <div
          // Стиль
          className="bar"
          // Роль для экранного диктора
          role="progressbar"
          // Описание
          aria-label="Прогресс плетения"
          // Минимум
          aria-valuemin={1}
          // Максимум
          aria-valuemax={totalSteps}
          // Текущее
          aria-valuenow={step}
        >
          {/* Заполненная часть */}
          <span style={{ width: `${percent}%` }} />
        </div>
        {/* Проценты */}
        <span className="weave-percent">{num(percent, 1)} %</span>
        {/* Прогноз окончания */}
        <span className="weave-eta" data-testid="eta" title="По вашему темпу плетения">
          {/* Значок */}
          <Icon name="clock" size={16} />
          {/* «≈ 3 ч 10 мин» или «готово» */}
          {finished ? "готово" : `≈ ${duration(eta.remainingSec)}`}
        </span>
        {/* Расход лески */}
        <span className="thread-used" data-testid="thread-used">
          {/* Текст */}
          Уже натянуто {num(cumulative[step - 1] ?? 0, 1)} м из {num(cumulative[totalSteps] ?? 0, 1)} м лески
        </span>
      </header>

      {/* Сцена: видео или схема */}
      <section className="weave-stage" ref={stageRef} aria-label={hasVideo ? "Видео" : "Схема"}>
        {/* Видео — плеер, иначе — картина */}
        {hasVideo ? <MediaStage lib={video} /> : <div className="stage-board">{board}</div>}
        {/* Панель под видео */}
        {hasVideo && (
          // Блок
          <div className="stage-bar">
            {/* Название ролика */}
            <span className="stage-title">{video.current?.title}</span>
            {/* «Следующее» — если роликов больше одного */}
            {video.items.length > 1 && (
              // Кнопка
              <button type="button" className="btn ghost small on-dark" onClick={video.next} disabled={video.index >= video.items.length - 1}>
                {/* Значок */}
                <Icon name="skip" size={16} />
                {/* Надпись */}
                Следующее
              </button>
            )}
            {/* Кнопка кино */}
            <button type="button" className="btn ghost small on-dark" onClick={() => void cinema.toggle()} data-testid="cinema-toggle">
              {/* Значок */}
              <Icon name={cinema.on ? "shrink" : "expand"} size={16} />
              {/* Надпись */}
              {cinema.on ? "Выйти из кино" : "Кино: на весь экран с шагами"}
            </button>
          </div>
        )}
        {/* Панель поверх видео в режиме кино */}
        {cinema.on && (
          // Блок
          <div className="cinema-hud" data-testid="cinema-hud">
            {/* Тонкая полоса прогресса */}
            <div className="hud-progress">
              {/* Заполненная часть */}
              <span style={{ width: `${percent}%` }} />
            </div>
            {/* Ряд: шаг, счётчик, кнопки */}
            <div className="hud-row">
              {/* Компактная строка шага */}
              {stepLine(false)}
              {/* Счётчик */}
              <span className="hud-count">
                {/* «120 / 3 000» */}
                {num(step)} / {num(totalSteps)}
              </span>
              {/* Кнопки */}
              <div className="hud-buttons">
                {/* Назад */}
                <button type="button" className="hud-btn" onClick={() => goTo(step - 1)} disabled={step <= 1} aria-label="Назад">
                  {/* Значок */}
                  <Icon name="prev" size={18} />
                </button>
                {/* Пауза/старт */}
                <button type="button" className="hud-btn play" onClick={togglePlay} disabled={finished} aria-label={playLabel}>
                  {/* Значок */}
                  <Icon name={playing ? "pause" : "play"} size={22} />
                </button>
                {/* Вперёд */}
                <button type="button" className="hud-btn" onClick={() => goTo(step + 1)} disabled={step >= totalSteps} aria-label="Вперёд">
                  {/* Значок */}
                  <Icon name="next" size={18} />
                </button>
                {/* Выйти из кино */}
                <button type="button" className="hud-btn" onClick={() => void cinema.toggle()} aria-label="Выйти из кино">
                  {/* Значок */}
                  <Icon name="shrink" size={18} />
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Правая колонка */}
      <aside className="weave-rail">
        {/* Карточка текущего шага */}
        <section className="step-card" aria-label="Текущий шаг">
          {/* Крупная строка шага */}
          {stepLine(true)}
          {/* Подсказка */}
          <p className="weave-hint">{hint}</p>
          {/* Предупреждение о катушке */}
          {spoolAlert}
          {/* Кнопки управления */}
          <div className="transport">
            {/* Назад */}
            <button type="button" className="round-btn" onClick={() => goTo(step - 1)} disabled={step <= 1} aria-label="Назад" title="Назад (←)">
              {/* Значок */}
              <Icon name="prev" size={20} />
            </button>
            {/* Главная кнопка */}
            <button
              // Тип
              type="button"
              // Стиль
              className="round-btn play"
              // Нажатие
              onClick={togglePlay}
              // Нажата ли (для экранного диктора)
              aria-pressed={playing}
              // Описание
              aria-label={playLabel}
              // Всё пройдено — неактивна
              disabled={finished}
            >
              {/* Значок */}
              <Icon name={playing ? "pause" : "play"} size={26} />
              {/* Надпись под значком */}
              <span className="play-text" aria-hidden="true">
                {/* Текст */}
                {playLabel}
              </span>
            </button>
            {/* Вперёд */}
            <button
              // Тип
              type="button"
              // Стиль
              className="round-btn"
              // Нажатие
              onClick={() => goTo(step + 1)}
              // На последнем шаге неактивна
              disabled={step >= totalSteps}
              // Описание
              aria-label="Вперёд"
              // Подсказка
              title="Вперёд (→)"
            >
              {/* Значок */}
              <Icon name="next" size={20} />
            </button>
          </div>
          {/* Скорость */}
          <div className="speed" role="group" aria-label="Скорость автоперелистывания">
            {/* Быстрее */}
            <button
              // Тип
              type="button"
              // Стиль
              className="icon-btn"
              // Нажатие
              onClick={() => changeSpeed(faster(speed))}
              // Неактивна на минимуме
              disabled={!canGoFaster(speed)}
              // Описание
              aria-label="Быстрее на 0,1 с"
              // Подсказка
              title={`Быстрее (↑), минимум ${seconds(MIN_SPEED_SEC)}`}
            >
              {/* Значок */}
              <Icon name="minus" />
            </button>
            {/* Текущая скорость */}
            <output className="speed-value" data-testid="speed">
              {/* Текст */}
              {seconds(speed)} на шаг
            </output>
            {/* Медленнее */}
            <button
              // Тип
              type="button"
              // Стиль
              className="icon-btn"
              // Нажатие
              onClick={() => changeSpeed(slower(speed))}
              // Неактивна на максимуме
              disabled={!canGoSlower(speed)}
              // Описание
              aria-label="Медленнее на 0,1 с"
              // Подсказка
              title={`Медленнее (↓), максимум ${seconds(MAX_SPEED_SEC)}`}
            >
              {/* Значок */}
              <Icon name="plus" />
            </button>
          </div>
        </section>

        {/* Схема в колонке, когда на сцене видео */}
        {hasVideo && <div className="rail-board">{board}</div>}
        {/* Музыка */}
        <MusicDock lib={music} />
      </aside>

      {/* Нижняя панель настроек */}
      <section className="weave-settings">
        {/* Вкладки */}
        <Tabs
          // Подпись
          label="Настройки плетения"
          // Активная
          value={tab}
          // Переключение
          onChange={setTab}
          // Список вкладок
          tabs={[
            // Вкладка «Видео»
            {
              // id
              id: "video",
              // Заголовок
              title: (
                // Фрагмент
                <>
                  {/* Значок и текст */}
                  <Icon name="film" size={18} /> Видео
                </>
              ),
              // Содержимое
              panel: <VideoPanel lib={video} />,
            },
            // Вкладка «Сигнал шага»
            {
              // id
              id: "sound",
              // Заголовок
              title: (
                // Фрагмент
                <>
                  {/* Значок и текст */}
                  <Icon name="bell" size={18} /> Сигнал шага
                </>
              ),
              // Содержимое
              panel: (
                // Панель
                <div className="sound-panel">
                  {/* Выбор звука */}
                  <div className="segmented-wide" role="radiogroup" aria-label="Сигнал шага">
                    {/* Кнопка на каждый вариант */}
                    {SOUND_OPTIONS.map((o) => (
                      // Кнопка
                      <button
                        // Ключ
                        key={o.value}
                        // Тип
                        type="button"
                        // Роль
                        role="radio"
                        // Выбран ли
                        aria-checked={sound.kind === o.value}
                        // Голос недоступен без синтеза речи
                        disabled={o.value === "voice" && !voiceAvailable}
                        // Выбрать
                        onClick={() => updateSound({ ...sound, kind: o.value })}
                      >
                        {/* Значок */}
                        <Icon name={o.icon} size={18} />
                        {/* Подпись */}
                        {o.label}
                      </button>
                    ))}
                  </div>
                  {/* Для голоса — что произносить */}
                  {sound.kind === "voice" && (
                    // Поле
                    <label className="inline-field">
                      {/* Подпись */}
                      <span>Произносить</span>
                      {/* Список */}
                      <select
                        // Описание
                        aria-label="Что озвучивать"
                        // Значение
                        value={sound.voiceMode}
                        // Изменение
                        onChange={(e) => updateSound({ ...sound, voiceMode: e.target.value as VoiceMode })}
                      >
                        {/* Только куда */}
                        <option value="target">только куда тянуть</option>
                        {/* Откуда и куда */}
                        <option value="full">откуда и куда</option>
                      </select>
                    </label>
                  )}
                  {/* Для сигнала — громкость */}
                  {sound.kind === "chime" && (
                    // Ползунок
                    <Slider
                      // id
                      id="chime-volume"
                      // Подпись
                      label="Громкость сигнала"
                      // Минимум
                      min={0.1}
                      // Максимум
                      max={1}
                      // Шаг
                      step={0.05}
                      // Значение
                      value={sound.volume}
                      // Показ в процентах
                      display={`${num(Math.round(sound.volume * 100))} %`}
                      // Изменение
                      onChange={(v) => updateSound({ ...sound, volume: v })}
                    />
                  )}
                  {/* Предупреждение, если голоса нет */}
                  {!voiceAvailable && <small className="muted">Голос недоступен: браузер не умеет синтезировать речь.</small>}
                </div>
              ),
            },
            // Вкладка «Управление»
            {
              // id
              id: "control",
              // Заголовок
              title: (
                // Фрагмент
                <>
                  {/* Значок и текст */}
                  <Icon name="voice" size={18} /> Управление
                </>
              ),
              // Содержимое
              panel: (
                // Панель управления
                <ControlPanel
                  // Голос включён
                  voiceOn={voiceOn}
                  // Переключатель
                  setVoiceOn={setVoiceOn}
                  // Состояние распознавания
                  voiceStatus={voice.status}
                  // Услышанное
                  heard={voice.heard}
                  // Переход к шагу
                  onJump={goTo}
                />
              ),
            },
            // Вкладка «Время»
            {
              // id
              id: "time",
              // Заголовок
              title: (
                // Фрагмент
                <>
                  {/* Значок и текст */}
                  <Icon name="clock" size={18} /> Время
                </>
              ),
              // Содержимое
              panel: <TimePanel eta={eta} activity={activity} breakMin={breakMin} setBreakMin={setBreakMin} />,
            },
          ]}
        />
      </section>
      {/* Тост перерыва */}
      {(breakDue || breakLeft > 0) && (
        // Блок
        <div className="break-toast" role="status" data-testid="break-toast">
          {/* Идёт перерыв или пора на перерыв */}
          {breakLeft > 0 ? (
            // Фрагмент «идёт перерыв»
            <>
              {/* Обратный отсчёт м:сс */}
              <strong>Перерыв: {Math.floor(breakLeft / 60)}:{String(breakLeft % 60).padStart(2, "0")}</strong>
              {/* Что сделать */}
              <span>Встаньте, разомните кисти и плечи, посмотрите вдаль. Сигнал позовёт обратно.</span>
              {/* Вернуться раньше */}
              <button type="button" className="btn secondary small" onClick={() => setBreakLeft(0)}>
                {/* Надпись */}
                Вернуться раньше
              </button>
            </>
          // Иначе
          ) : (
            // Фрагмент «пора на перерыв»
            <>
              {/* Сколько уже плетёте */}
              <strong>Вы плетёте уже {duration(sessionSec)}</strong>
              {/* Совет */}
              <span>Пора размять руки и дать отдохнуть глазам.</span>
              {/* Кнопки */}
              <div className="break-actions">
                {/* Начать перерыв */}
                <button type="button" className="btn primary small" onClick={startBreak}>
                  {/* Надпись */}
                  Перерыв 5 минут
                </button>
                {/* Отложить */}
                <button type="button" className="btn ghost small" onClick={snoozeBreak}>
                  {/* Надпись */}
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
