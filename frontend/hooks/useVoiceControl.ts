// Хук работает в браузере
"use client";

// Хуки React
import { useEffect, useRef, useState } from "react";
// Распознавание речи и разбор команд
import { recognitionCtor, voiceCommand, type Command } from "@/lib/control";

// Состояние голосового управления
export type VoiceStatus = "off" | "listening" | "unsupported" | "denied" | "error";

/**
 * Голосовые команды через распознавание речи браузера (Chrome, Edge, Яндекс Браузер).
 * Распознавание после паузы само останавливается — перезапускаем, пока включено.
 */
// Хук голосового управления
export function useVoiceControl(enabled: boolean, onCommand: (c: Command, heard: string) => void) {
  // Состояние
  const [status, setStatus] = useState<VoiceStatus>("off");
  // Последняя услышанная фраза (показываем человеку)
  const [heard, setHeard] = useState("");
  // Свежий обработчик команд
  const handler = useRef(onCommand);
  // Обновляем при каждом рендере
  handler.current = onCommand;
  // Поддерживает ли браузер распознавание
  const supported = typeof window !== "undefined" && recognitionCtor() !== null;

  // Включение/выключение
  useEffect(() => {
    // Конструктор распознавания
    const Ctor = recognitionCtor();
    // Выключено
    if (!enabled) {
      // Состояние «выкл»
      setStatus("off");
      // Больше ничего не делаем
      return;
    }
    // Браузер не умеет
    if (!Ctor) {
      // Состояние «не поддерживается»
      setStatus("unsupported");
      // Выход
      return;
    }
    // Флаг «остановлено намеренно» (тогда не перезапускаем)
    let stopped = false;
    // Новый распознаватель
    const rec = new Ctor();
    // Русский язык
    rec.lang = "ru-RU";
    // Слушать непрерывно
    rec.continuous = true;
    // Только окончательные результаты
    rec.interimResults = false;
    // До трёх вариантов распознавания на фразу
    rec.maxAlternatives = 3;
    // Пришёл результат
    rec.onresult = (e) => {
      // Новые фразы начиная с resultIndex
      for (let i = e.resultIndex; i < e.results.length; i++) {
        // Фраза
        const res = e.results[i];
        // Промежуточные пропускаем
        if (!res.isFinal) continue;
        // Перебираем варианты распознавания
        for (let a = 0; a < res.length; a++) {
          // Текст варианта
          const text = res[a].transcript.trim();
          // Команда ли это
          const cmd = voiceCommand(text);
          // Да
          if (cmd) {
            // Показываем, что услышали
            setHeard(text);
            // Выполняем команду
            handler.current(cmd, text);
            // Остальные варианты не нужны
            break;
          }
          // Не команда — показываем первый (самый вероятный) вариант
          if (a === 0) setHeard(text);
        }
      }
    };
    // Ошибка
    rec.onerror = (e) => {
      // Нет разрешения на микрофон
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        // Не перезапускать
        stopped = true;
        // Состояние «запрещено»
        setStatus("denied");
        // «Тишина» и «прервано» — обычные события; остальное — ошибка
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        // Состояние «ошибка»
        setStatus("error");
      }
    };
    // Распознавание остановилось само (пауза в речи)
    rec.onend = () => {
      // Если не выключали — запускаем снова
      if (!stopped) {
        // start может бросить исключение, если уже запущено
        try {
          // Перезапуск
          rec.start();
          // Уже работает
        } catch {
          /* уже запущено */
        }
      }
    };
    // Первый запуск
    try {
      // Старт (браузер спросит разрешение на микрофон)
      rec.start();
      // Слушаем
      setStatus("listening");
      // Не получилось
    } catch {
      // Ошибка
      setStatus("error");
    }
    // При выключении или уходе со страницы
    return () => {
      // Намеренная остановка
      stopped = true;
      // Не перезапускать
      rec.onend = null;
      // stop может бросить исключение
      try {
        // Остановить
        rec.stop();
        // Уже остановлено
      } catch {
        /* уже остановлено */
      }
    };
    // Перезапуск при смене enabled
  }, [enabled]);

  // Наружу
  return { status, heard, supported };
}
