"use client";

import { useEffect, useRef, useState } from "react";
import { recognitionCtor, voiceCommand, type Command } from "@/lib/control";

export type VoiceStatus = "off" | "listening" | "unsupported" | "denied" | "error";

/**
 * Голосовые команды через распознавание речи браузера (Chrome, Edge, Яндекс Браузер).
 * Распознавание после паузы само останавливается — перезапускаем, пока включено.
 */
export function useVoiceControl(enabled: boolean, onCommand: (c: Command, heard: string) => void) {
  const [status, setStatus] = useState<VoiceStatus>("off");
  const [heard, setHeard] = useState("");
  const handler = useRef(onCommand);
  handler.current = onCommand;
  const supported = typeof window !== "undefined" && recognitionCtor() !== null;

  useEffect(() => {
    const Ctor = recognitionCtor();
    if (!enabled) {
      setStatus("off");
      return;
    }
    if (!Ctor) {
      setStatus("unsupported");
      return;
    }
    let stopped = false;
    const rec = new Ctor();
    rec.lang = "ru-RU";
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (!res.isFinal) continue;
        for (let a = 0; a < res.length; a++) {
          const text = res[a].transcript.trim();
          const cmd = voiceCommand(text);
          if (cmd) {
            setHeard(text);
            handler.current(cmd, text);
            break;
          }
          if (a === 0) setHeard(text);
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        stopped = true;
        setStatus("denied");
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        setStatus("error");
      }
    };
    rec.onend = () => {
      if (!stopped) {
        try {
          rec.start();
        } catch {
          /* уже запущено */
        }
      }
    };
    try {
      rec.start();
      setStatus("listening");
    } catch {
      setStatus("error");
    }
    return () => {
      stopped = true;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        /* уже остановлено */
      }
    };
  }, [enabled]);

  return { status, heard, supported };
}
