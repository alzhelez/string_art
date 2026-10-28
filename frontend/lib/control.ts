// Управление без рук: кликер для презентаций, педаль, медиа-клавиши и голос.

// Команды управления плетением
export type Command = "next" | "prev" | "toggle" | "play" | "pause" | "faster" | "slower" | "repeat";

/**
 * Клавиши → команды. Кликеры для презентаций шлют PageDown/PageUp (иногда стрелки),
 * кнопка «чёрный экран» — B или точку. Педали настраиваются на любую из этих клавиш.
 */
// Клавиша → команда (или null, если клавиша не наша)
export function keyCommand(e: Pick<KeyboardEvent, "key" | "code">): Command | null {
  // По названию клавиши
  switch (e.key) {
    // Стрелка вправо
    case "ArrowRight":
    // Кликер «вперёд»
    case "PageDown":
    // Медиа-кнопка «следующий трек» (наушники, клавиатура)
    case "MediaTrackNext":
      // Следующий шаг
      return "next";
    // Стрелка влево
    case "ArrowLeft":
    // Кликер «назад»
    case "PageUp":
    // Медиа «предыдущий трек»
    case "MediaTrackPrevious":
      // Предыдущий шаг
      return "prev";
    // Пробел
    case " ":
    // Медиа «пауза/играть»
    case "MediaPlayPause":
    // Кликер «чёрный экран» шлёт B
    case "b":
    // Заглавная B
    case "B":
    // Та же клавиша в русской раскладке
    case "и": // B в русской раскладке
    // Заглавная
    case "И":
    // Некоторые кликеры шлют точку
    case ".":
      // Пауза/продолжить
      return "toggle";
    // Медиа «стоп»
    case "MediaStop":
      // Пауза
      return "pause";
    // Стрелка вверх
    case "ArrowUp":
      // Быстрее
      return "faster";
    // Стрелка вниз
    case "ArrowDown":
      // Медленнее
      return "slower";
  }
  // Пробел мог прийти с другим key (раскладка) — проверяем физическую клавишу
  return e.code === "Space" ? "toggle" : null;
}

// Как называть клавишу для человека (при проверке кликера)
export const KEY_NAMES: Record<string, string> = {
  // Пробел
  " ": "Пробел",
  // Стрелки
  ArrowRight: "→",
  // Влево
  ArrowLeft: "←",
  // Вверх
  ArrowUp: "↑",
  // Вниз
  ArrowDown: "↓",
  // Кликер вперёд
  PageDown: "PageDown",
  // Кликер назад
  PageUp: "PageUp",
  // Медиа-кнопки
  MediaTrackNext: "медиа «следующий»",
  // Медиа назад
  MediaTrackPrevious: "медиа «предыдущий»",
  // Медиа пауза
  MediaPlayPause: "медиа «пауза»",
};

// --- голос ---------------------------------------------------------------------
// Фразы уже без «ё» (см. voiceCommand)
// Список: команда и шаблон фраз (^…$ — фраза целиком)
const VOICE: [Command, RegExp][] = [
  // Вперёд
  ["next", /^(дальше|далее|вперед|следующий|следующая|next|го|давай)$/],
  // Назад
  ["prev", /^(назад|обратно|предыдущий|предыдущая|верни|back)$/],
  // Пауза
  ["pause", /^(стоп|пауза|стой|подожди|хватит|stop|pause)$/],
  // Продолжить
  ["play", /^(старт|поехали|продолжи|продолжить|продолжай|начали|play|start)$/],
  // Быстрее
  ["faster", /^(быстрее|побыстрее|ускорь)$/],
  // Медленнее
  ["slower", /^(медленнее|помедленнее|притормози|замедли)$/],
  // Повторить текущий шаг вслух
  ["repeat", /^(повтори|еще раз|какой шаг|где я)$/],
];

/**
 * Фраза → команда. Команда — это вся фраза целиком (1–3 слова): так фильм на фоне
 * со словом «дальше» посреди реплики не листает шаги.
 */
// Распознанная фраза → команда
export function voiceCommand(text: string): Command | null {
  // Нормализуем фразу
  const phrase = text
    // Строчные буквы
    .toLowerCase()
    // ё → е (распознаватель пишет по-разному)
    .replace(/ё/g, "е")
    // Знаки препинания → пробелы
    .replace(/[.,!?…]/g, " ")
    // Несколько пробелов → один
    .replace(/\s+/g, " ")
    // Убрать пробелы по краям
    .trim();
  // Пусто или длиннее трёх слов — это не команда, а речь (фильм, разговор)
  if (!phrase || phrase.split(" ").length > 3) return null;
  // Можно обращаться «нить, дальше» — убираем обращение
  const normalized = phrase.replace(/^(нить|нитка|слушай)\s+/, "");
  // Ищем подходящий шаблон
  for (const [cmd, re] of VOICE) if (re.test(normalized)) return cmd;
  // Не команда
  return null;
}

// Минимальное описание объекта распознавания речи (в стандартных типах TypeScript его нет)
type Recognition = {
  // Язык распознавания
  lang: string;
  // Слушать непрерывно
  continuous: boolean;
  // Отдавать промежуточные варианты
  interimResults: boolean;
  // Сколько вариантов на фразу
  maxAlternatives: number;
  // Начать
  start: () => void;
  // Остановить
  stop: () => void;
  // Обработчик результата: список фраз с вариантами и признаком «окончательный»
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  // Обработчик ошибки (нет доступа к микрофону и т. п.)
  onerror: ((e: { error: string }) => void) | null;
  // Распознавание остановилось
  onend: (() => void) | null;
};

// Конструктор распознавания речи браузера (или null, если не поддерживается)
export function recognitionCtor(): (new () => Recognition) | null {
  // На сервере — нет
  if (typeof window === "undefined") return null;
  // window с возможными полями
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  // Стандартное имя или с префиксом webkit (Safari, старый Chrome)
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
