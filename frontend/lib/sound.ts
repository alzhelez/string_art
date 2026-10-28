// Звук на каждом шаге: тишина, короткий сигнал или голос.
// Тип режима голосовой озвучки
import type { VoiceMode } from "./speech";

// Варианты звука шага: нет / сигнал / голос
export type StepSound = "none" | "chime" | "voice";

// Настройки звука
export interface SoundPrefs {
  // Вариант звука
  kind: StepSound;
  // Режим голоса
  voiceMode: VoiceMode;
  // Громкость сигнала
  volume: number; // громкость сигнала 0..1
}

// Настройки по умолчанию: сигнал, озвучка «куда», громкость 50 %
export const DEFAULT_SOUND: SoundPrefs = { kind: "chime", voiceMode: "target", volume: 0.5 };
// Ключ хранения в localStorage браузера
const KEY = "stringart.sound";
// Ключ настроек первой версии (их переносим)
const LEGACY_VOICE_KEY = "stringart.voice";

// Прочитать сохранённые настройки
export function readSoundPrefs(): SoundPrefs {
  // localStorage может быть недоступен, а JSON — испорчен
  try {
    // Текущие настройки
    const raw = localStorage.getItem(KEY);
    // Есть
    if (raw) {
      // Разбираем JSON
      const v = JSON.parse(raw);
      // Каждое поле проверяем — в хранилище может лежать что угодно
      return {
        // Только известные варианты, иначе — сигнал
        kind: v.kind === "voice" || v.kind === "none" ? v.kind : "chime",
        // Режим голоса
        voiceMode: v.voiceMode === "full" ? "full" : "target",
        // Громкость в пределах 0..1
        volume: typeof v.volume === "number" ? Math.min(1, Math.max(0, v.volume)) : DEFAULT_SOUND.volume,
      };
    }
    // Настройки старой версии
    const legacy = localStorage.getItem(LEGACY_VOICE_KEY); // настройки первой версии
    // Если есть — переводим в новый формат
    if (legacy) {
      // Разбираем
      const v = JSON.parse(legacy);
      // Голос включён → «голос», иначе — сигнал
      return { ...DEFAULT_SOUND, kind: v.enabled ? "voice" : "chime", voiceMode: v.mode === "full" ? "full" : "target" };
    }
    // Ошибка — берём настройки по умолчанию
  } catch {
    /* приватный режим или битые данные */
  }
  // По умолчанию
  return DEFAULT_SOUND;
}

// Сохранить настройки
export function saveSoundPrefs(p: SoundPrefs): void {
  // Хранилище может быть недоступно
  try {
    // Записываем JSON
    localStorage.setItem(KEY, JSON.stringify(p));
    // Не получилось — не страшно
  } catch {
    /* не критично */
  }
}

// Один аудиоконтекст на всё приложение (создаётся при первом сигнале)
let ctx: AudioContext | null = null;

/** Короткий мягкий двухтоновый сигнал (~0,25 с). Слышен поверх музыки, не мешает фильму. */
// Проиграть сигнал
export function chime(volume = 0.5): void {
  // На сервере или при нулевой громкости — молчим
  if (typeof window === "undefined" || volume <= 0) return;
  // Конструктор AudioContext (в старом Safari — с префиксом webkit)
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  // Звук не поддерживается
  if (!AC) return;
  // Создаём контекст один раз (??= — только если ещё null)
  ctx ??= new AC();
  // Браузер «усыпляет» звук до первого действия пользователя — будим
  if (ctx.state === "suspended") void ctx.resume();
  // Текущее время аудиоконтекста
  const now = ctx.currentTime;
  // Две ноты: [частота Гц, задержка с]
  [
    // Ля второй октавы — сразу
    [880, 0],
    // Ми третьей октавы — через 0,09 с
    [1320, 0.09],
    // Для каждой ноты создаём свой генератор
  ].forEach(([freq, delay]) => {
    // Генератор звука
    const osc = ctx!.createOscillator();
    // Регулятор громкости
    const gain = ctx!.createGain();
    // Мягкая синусоида
    osc.type = "sine";
    // Частота ноты
    osc.frequency.value = freq;
    // Начинаем с тишины
    gain.gain.setValueAtTime(0, now + delay);
    // Быстро (за 10 мс) нарастает — без щелчка
    gain.gain.linearRampToValueAtTime(0.25 * volume, now + delay + 0.01);
    // Плавно затихает
    gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.16);
    // Генератор → громкость → динамики
    osc.connect(gain).connect(ctx!.destination);
    // Включить в нужный момент
    osc.start(now + delay);
    // Выключить
    osc.stop(now + delay + 0.18);
  });
}
