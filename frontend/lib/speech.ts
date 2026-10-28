// Голосовая озвучка шагов через Web Speech API (работает офлайн в Chrome/Safari/Edge).
// Номер гвоздя в секторе и буква сектора
import { nailNumber, nailSector } from "./nails";

// Режим озвучки: только «куда» или «откуда, куда»
export type VoiceMode = "target" | "full";

// Латинские буквы секторов читаем по-русски, чтобы синтезатор не сказал «эй», «би», «си».
// Как произносить букву сектора
const SPOKEN_SECTOR: Record<string, string> = { A: "А", B: "Бэ", C: "Цэ", D: "Дэ" };

// Гвоздь словами: «Цэ 37»
export function spokenNail(index: number): string {
  // Буква по-русски + номер
  return `${SPOKEN_SECTOR[nailSector(index)]} ${nailNumber(index)}`;
}

// Фраза для шага
export function spokenStep(from: number, to: number, mode: VoiceMode): string {
  // Полный режим — оба гвоздя через запятую, иначе только целевой
  return mode === "full" ? `${spokenNail(from)}, ${spokenNail(to)}` : spokenNail(to);
}

// Умеет ли браузер синтез речи
export function speechSupported(): boolean {
  // На сервере (при сборке) window нет; в браузере проверяем наличие speechSynthesis
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// Найденный русский голос (undefined — ещё не искали)
let cachedVoice: SpeechSynthesisVoice | null | undefined;

// Русский голос из установленных в системе
function russianVoice(): SpeechSynthesisVoice | null {
  // Уже нашли — отдаём (null не кэшируем: список голосов в Chrome загружается не сразу)
  if (cachedVoice !== undefined && cachedVoice !== null) return cachedVoice;
  // Список голосов
  const voices = window.speechSynthesis.getVoices();
  // Первый голос с языком ru-…
  cachedVoice = voices.find((v) => v.lang.toLowerCase().startsWith("ru")) ?? null;
  // Найденный или null
  return cachedVoice;
}

/** Произносит текст, обрывая предыдущую фразу, чтобы озвучка не отставала от шагов. */
// Сказать фразу
export function speak(text: string, rate = 1.15): void {
  // Нет синтеза — молчим
  if (!speechSupported()) return;
  // Синтезатор
  const synth = window.speechSynthesis;
  // Обрываем незаконченную фразу
  synth.cancel();
  // Новая фраза
  const u = new SpeechSynthesisUtterance(text);
  // Язык — русский
  u.lang = "ru-RU";
  // Чуть быстрее обычного
  u.rate = rate;
  // Русский голос
  const voice = russianVoice();
  // Если нашёлся — используем
  if (voice) u.voice = voice;
  // Говорим
  synth.speak(u);
}

// Замолчать
export function stopSpeaking(): void {
  // Если синтез есть — отменяем всё
  if (speechSupported()) window.speechSynthesis.cancel();
}
