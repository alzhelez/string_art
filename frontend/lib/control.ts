// Управление без рук: кликер для презентаций, педаль, медиа-клавиши и голос.

export type Command = "next" | "prev" | "toggle" | "play" | "pause" | "faster" | "slower" | "repeat";

/**
 * Клавиши → команды. Кликеры для презентаций шлют PageDown/PageUp (иногда стрелки),
 * кнопка «чёрный экран» — B или точку. Педали настраиваются на любую из этих клавиш.
 */
export function keyCommand(e: Pick<KeyboardEvent, "key" | "code">): Command | null {
  switch (e.key) {
    case "ArrowRight":
    case "PageDown":
    case "MediaTrackNext":
      return "next";
    case "ArrowLeft":
    case "PageUp":
    case "MediaTrackPrevious":
      return "prev";
    case " ":
    case "MediaPlayPause":
    case "b":
    case "B":
    case "и": // B в русской раскладке
    case "И":
    case ".":
      return "toggle";
    case "MediaStop":
      return "pause";
    case "ArrowUp":
      return "faster";
    case "ArrowDown":
      return "slower";
  }
  return e.code === "Space" ? "toggle" : null;
}

export const KEY_NAMES: Record<string, string> = {
  " ": "Пробел",
  ArrowRight: "→",
  ArrowLeft: "←",
  ArrowUp: "↑",
  ArrowDown: "↓",
  PageDown: "PageDown",
  PageUp: "PageUp",
  MediaTrackNext: "медиа «следующий»",
  MediaTrackPrevious: "медиа «предыдущий»",
  MediaPlayPause: "медиа «пауза»",
};

// --- голос ---------------------------------------------------------------------
// Фразы уже без «ё» (см. voiceCommand)
const VOICE: [Command, RegExp][] = [
  ["next", /^(дальше|далее|вперед|следующий|следующая|next|го|давай)$/],
  ["prev", /^(назад|обратно|предыдущий|предыдущая|верни|back)$/],
  ["pause", /^(стоп|пауза|стой|подожди|хватит|stop|pause)$/],
  ["play", /^(старт|поехали|продолжи|продолжить|продолжай|начали|play|start)$/],
  ["faster", /^(быстрее|побыстрее|ускорь)$/],
  ["slower", /^(медленнее|помедленнее|притормози|замедли)$/],
  ["repeat", /^(повтори|еще раз|какой шаг|где я)$/],
];

/**
 * Фраза → команда. Команда — это вся фраза целиком (1–3 слова): так фильм на фоне
 * со словом «дальше» посреди реплики не листает шаги.
 */
export function voiceCommand(text: string): Command | null {
  const phrase = text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[.,!?…]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!phrase || phrase.split(" ").length > 3) return null;
  const normalized = phrase.replace(/^(нить|нитка|слушай)\s+/, "");
  for (const [cmd, re] of VOICE) if (re.test(normalized)) return cmd;
  return null;
}

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
