// Компонент работает в браузере
"use client";

// Хуки React
import { useEffect, useState } from "react";
// Тип состояния голосового управления
import type { VoiceStatus } from "@/hooks/useVoiceControl";
// Названия клавиш, разбор клавиши в команду, тип команды
import { KEY_NAMES, keyCommand, type Command } from "@/lib/control";
// Переключатель
import { Switch } from "../ui/Controls";

// Команда → как её назвать человеку
const COMMAND_TEXT: Record<Command, string> = {
  // Вперёд
  next: "вперёд",
  // Назад
  prev: "назад",
  // Пауза/продолжить
  toggle: "старт / пауза",
  // Старт
  play: "старт",
  // Пауза
  pause: "пауза",
  // Быстрее
  faster: "быстрее",
  // Медленнее
  slower: "медленнее",
  // Повторить
  repeat: "повторить шаг",
};

// Подсказка для каждого состояния голосового управления
const VOICE_STATUS: Record<VoiceStatus, string> = {
  // Выключено — без подсказки
  off: "",
  // Слушаем
  listening: "Слушаю. Говорите коротко: «дальше», «назад», «стоп», «поехали».",
  // Браузер не умеет распознавать речь
  unsupported:
    // Текст подсказки
    "Здесь речь не распознаётся. Работает в Chrome, Edge и Яндекс Браузере; в программе для Windows запустите её с ключом --browser.",
  // Нет разрешения на микрофон
  denied: "Нет доступа к микрофону. Разрешите его в настройках браузера (значок замка в адресной строке).",
  // Сервис распознавания не отвечает
  error: "Распознавание речи не отвечает — нужен интернет (речь распознаёт сервис браузера).",
};

/** Вкладка «Управление»: голос, кликер или педаль, переход к шагу. */
// Вкладка «Управление»
export function ControlPanel({
  // Голос включён
  voiceOn,
  // Включить/выключить голос
  setVoiceOn,
  // Состояние голосового управления
  voiceStatus,
  // Последняя услышанная фраза
  heard,
  // Перейти к шагу
  onJump,
// Типы свойств
}: {
  // Голос включён
  voiceOn: boolean;
  // Переключатель голоса
  setVoiceOn: (v: boolean) => void;
  // Состояние
  voiceStatus: VoiceStatus;
  // Услышанное
  heard: string;
  // Переход
  onJump: (step: number) => void;
// Тело компонента
}) {
  // Текст поля «перейти к шагу»
  const [jump, setJump] = useState("");
  // Последняя нажатая клавиша и что она значит
  const [lastKey, setLastKey] = useState<{ key: string; cmd: Command | null } | null>(null);

  // Проверка кликера/педали: показываем, что пришло и что это значит
  // Слушаем клавиатуру
  useEffect(() => {
    // Нажатие
    const onKey = (e: KeyboardEvent) => {
      // Где нажали
      const t = e.target;
      // В полях ввода — это ввод текста, а не кликер
      if (t instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      // Запоминаем клавишу и команду
      setLastKey({ key: e.key, cmd: keyCommand(e) });
    };
    // Подписка
    window.addEventListener("keydown", onKey);
    // Отписка при уходе
    return () => window.removeEventListener("keydown", onKey);
  // Один раз
  }, []);

  // Разметка
  return (
    // Панель
    <div className="control-panel">
      {/* Блок «голос» */}
      <div className="control-block">
        {/* Переключатель голосовых команд */}
        <Switch
          // Подпись
          label="Голосовые команды"
          // Состояние
          checked={voiceOn}
          // Обработчик
          onChange={setVoiceOn}
          // Метка для тестов
          testId="voice-switch"
          // Пояснение
          hint={
            // Включено?
            voiceOn
              // Да — подсказка по состоянию
              ? VOICE_STATUS[voiceStatus]
              // Нет — что умеет голос
              : "Руки заняты леской — листайте голосом: «дальше», «назад», «стоп», «поехали», «быстрее», «медленнее», «повтори»."
          }
          // Ошибки показываем как alert — экранный диктор прочитает сразу
          hintRole={voiceStatus === "denied" || voiceStatus === "error" || voiceStatus === "unsupported" ? "alert" : undefined}
        />
        {/* Что услышали (если голос включён) */}
        {voiceOn && heard && (
          // Абзац
          <p className="heard" data-testid="voice-heard">
            {/* «Услышано: …» */}
            Услышано: «{heard}»
          </p>
        )}
      </div>

      {/* Блок «кликер» */}
      <div className="control-block">
        {/* Заголовок */}
        <h3>Кликер или педаль</h3>
        {/* Пояснение */}
        <p className="panel-lead">
          {/* Текст пояснения */}
          Подойдёт любой кликер для презентаций (кнопки «вперёд/назад» шлют PageDown/PageUp, «чёрный экран» —
          старт и пауза) или USB-педаль, настроенная на одну из этих клавиш. Нажмите кнопку — ниже будет видно, что
          пришло.
        </p>
        {/* Проверка клавиш; aria-live — экранный диктор озвучит изменение */}
        <p className="key-test" data-testid="key-test" aria-live="polite">
          {/* Нажимали — показываем, нет — ждём */}
          {lastKey ? (
            // Фрагмент
            <>
              {/* Название клавиши и пробел */}
              <kbd>{KEY_NAMES[lastKey.key] ?? lastKey.key}</kbd>{" "}
              {/* Что она делает */}
              {lastKey.cmd ? `→ ${COMMAND_TEXT[lastKey.cmd]}` : "— эта клавиша ничего не делает"}
            </>
          // Иначе
          ) : (
            // Ещё ничего не нажимали
            "Жду нажатия…"
          )}
        </p>
      </div>

      {/* Форма «перейти к шагу» */}
      <form
        // Стиль
        className="jump"
        // Отправка формы (Enter или кнопка)
        onSubmit={(e) => {
          // Не перезагружать страницу
          e.preventDefault();
          // Введённый номер
          const n = Number(jump);
          // Правильное число — переходим
          if (Number.isFinite(n) && n >= 1) onJump(n);
          // Очищаем поле
          setJump("");
        }}
      >
        {/* Подпись поля */}
        <label htmlFor="jump-input">Перейти к шагу</label>
        {/* Поле номера шага (цифровая клавиатура на телефоне) */}
        <input id="jump-input" type="number" inputMode="numeric" min={1} value={jump} onChange={(e) => setJump(e.target.value)} />
        {/* Кнопка отправки */}
        <button type="submit" className="btn secondary small">
          {/* Надпись */}
          Перейти
        </button>
      </form>
      {/* Шпаргалка по клавишам */}
      <p className="keys">
        {/* Список клавиш */}
        <kbd>Пробел</kbd> или <kbd>B</kbd> старт и пауза, <kbd>→</kbd> <kbd>PageDown</kbd> вперёд, <kbd>←</kbd>{" "}
        {/* Продолжение списка клавиш */}
        <kbd>PageUp</kbd> назад, <kbd>↑</kbd> <kbd>↓</kbd> быстрее и медленнее, <kbd>F</kbd> кино
      </p>
    </div>
  );
}
