// Звук на каждом шаге: тишина, короткий сигнал или голос.
import type { VoiceMode } from "./speech";

export type StepSound = "none" | "chime" | "voice";

export interface SoundPrefs {
  kind: StepSound;
  voiceMode: VoiceMode;
  volume: number; // громкость сигнала 0..1
}

export const DEFAULT_SOUND: SoundPrefs = { kind: "chime", voiceMode: "target", volume: 0.5 };
const KEY = "stringart.sound";
const LEGACY_VOICE_KEY = "stringart.voice";

export function readSoundPrefs(): SoundPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw);
      return {
        kind: v.kind === "voice" || v.kind === "none" ? v.kind : "chime",
        voiceMode: v.voiceMode === "full" ? "full" : "target",
        volume: typeof v.volume === "number" ? Math.min(1, Math.max(0, v.volume)) : DEFAULT_SOUND.volume,
      };
    }
    const legacy = localStorage.getItem(LEGACY_VOICE_KEY); // настройки первой версии
    if (legacy) {
      const v = JSON.parse(legacy);
      return { ...DEFAULT_SOUND, kind: v.enabled ? "voice" : "chime", voiceMode: v.mode === "full" ? "full" : "target" };
    }
  } catch {
    /* приватный режим или битые данные */
  }
  return DEFAULT_SOUND;
}

export function saveSoundPrefs(p: SoundPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* не критично */
  }
}

let ctx: AudioContext | null = null;

/** Короткий мягкий двухтоновый сигнал (~0,25 с). Слышен поверх музыки, не мешает фильму. */
export function chime(volume = 0.5): void {
  if (typeof window === "undefined" || volume <= 0) return;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx ??= new AC();
  if (ctx.state === "suspended") void ctx.resume();
  const now = ctx.currentTime;
  [
    [880, 0],
    [1320, 0.09],
  ].forEach(([freq, delay]) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + delay);
    gain.gain.linearRampToValueAtTime(0.25 * volume, now + delay + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.16);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(now + delay);
    osc.stop(now + delay + 0.18);
  });
}
