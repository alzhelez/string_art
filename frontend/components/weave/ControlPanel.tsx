"use client";

import { useEffect, useState } from "react";
import type { VoiceStatus } from "@/hooks/useVoiceControl";
import { KEY_NAMES, keyCommand, type Command } from "@/lib/control";
import { Switch } from "../ui/Controls";

const COMMAND_TEXT: Record<Command, string> = {
  next: "вперёд",
  prev: "назад",
  toggle: "старт / пауза",
  play: "старт",
  pause: "пауза",
  faster: "быстрее",
  slower: "медленнее",
  repeat: "повторить шаг",
};

const VOICE_STATUS: Record<VoiceStatus, string> = {
  off: "",
  listening: "Слушаю. Говорите коротко: «дальше», «назад», «стоп», «поехали».",
  unsupported:
    "Здесь речь не распознаётся. Работает в Chrome, Edge и Яндекс Браузере; в программе для Windows запустите её с ключом --browser.",
  denied: "Нет доступа к микрофону. Разрешите его в настройках браузера (значок замка в адресной строке).",
  error: "Распознавание речи не отвечает — нужен интернет (речь распознаёт сервис браузера).",
};

/** Вкладка «Управление»: голос, кликер или педаль, переход к шагу. */
export function ControlPanel({
  voiceOn,
  setVoiceOn,
  voiceStatus,
  heard,
  onJump,
}: {
  voiceOn: boolean;
  setVoiceOn: (v: boolean) => void;
  voiceStatus: VoiceStatus;
  heard: string;
  onJump: (step: number) => void;
}) {
  const [jump, setJump] = useState("");
  const [lastKey, setLastKey] = useState<{ key: string; cmd: Command | null } | null>(null);

  // Проверка кликера/педали: показываем, что пришло и что это значит
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      setLastKey({ key: e.key, cmd: keyCommand(e) });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="control-panel">
      <div className="control-block">
        <Switch
          label="Голосовые команды"
          checked={voiceOn}
          onChange={setVoiceOn}
          testId="voice-switch"
          hint={
            voiceOn
              ? VOICE_STATUS[voiceStatus]
              : "Руки заняты леской — листайте голосом: «дальше», «назад», «стоп», «поехали», «быстрее», «медленнее», «повтори»."
          }
          hintRole={voiceStatus === "denied" || voiceStatus === "error" || voiceStatus === "unsupported" ? "alert" : undefined}
        />
        {voiceOn && heard && (
          <p className="heard" data-testid="voice-heard">
            Услышано: «{heard}»
          </p>
        )}
      </div>

      <div className="control-block">
        <h3>Кликер или педаль</h3>
        <p className="panel-lead">
          Подойдёт любой кликер для презентаций (кнопки «вперёд/назад» шлют PageDown/PageUp, «чёрный экран» —
          старт и пауза) или USB-педаль, настроенная на одну из этих клавиш. Нажмите кнопку — ниже будет видно, что
          пришло.
        </p>
        <p className="key-test" data-testid="key-test" aria-live="polite">
          {lastKey ? (
            <>
              <kbd>{KEY_NAMES[lastKey.key] ?? lastKey.key}</kbd>{" "}
              {lastKey.cmd ? `→ ${COMMAND_TEXT[lastKey.cmd]}` : "— эта клавиша ничего не делает"}
            </>
          ) : (
            "Жду нажатия…"
          )}
        </p>
      </div>

      <form
        className="jump"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(jump);
          if (Number.isFinite(n) && n >= 1) onJump(n);
          setJump("");
        }}
      >
        <label htmlFor="jump-input">Перейти к шагу</label>
        <input id="jump-input" type="number" inputMode="numeric" min={1} value={jump} onChange={(e) => setJump(e.target.value)} />
        <button type="submit" className="btn secondary small">
          Перейти
        </button>
      </form>
      <p className="keys">
        <kbd>Пробел</kbd> или <kbd>B</kbd> старт и пауза, <kbd>→</kbd> <kbd>PageDown</kbd> вперёд, <kbd>←</kbd>{" "}
        <kbd>PageUp</kbd> назад, <kbd>↑</kbd> <kbd>↓</kbd> быстрее и медленнее, <kbd>F</kbd> кино
      </p>
    </div>
  );
}
