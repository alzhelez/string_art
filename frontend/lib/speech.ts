// Голосовая озвучка шагов через Web Speech API (работает офлайн в Chrome/Safari/Edge).
import { nailNumber, nailSector } from "./nails";

export type VoiceMode = "target" | "full";

// Латинские буквы секторов читаем по-русски, чтобы синтезатор не сказал «эй», «би», «си».
const SPOKEN_SECTOR: Record<string, string> = { A: "А", B: "Бэ", C: "Цэ", D: "Дэ" };

export function spokenNail(index: number): string {
  return `${SPOKEN_SECTOR[nailSector(index)]} ${nailNumber(index)}`;
}

export function spokenStep(from: number, to: number, mode: VoiceMode): string {
  return mode === "full" ? `${spokenNail(from)}, ${spokenNail(to)}` : spokenNail(to);
}

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

let cachedVoice: SpeechSynthesisVoice | null | undefined;

function russianVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined && cachedVoice !== null) return cachedVoice;
  const voices = window.speechSynthesis.getVoices();
  cachedVoice = voices.find((v) => v.lang.toLowerCase().startsWith("ru")) ?? null;
  return cachedVoice;
}

/** Произносит текст, обрывая предыдущую фразу, чтобы озвучка не отставала от шагов. */
export function speak(text: string, rate = 1.15): void {
  if (!speechSupported()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ru-RU";
  u.rate = rate;
  const voice = russianVoice();
  if (voice) u.voice = voice;
  synth.speak(u);
}

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}
