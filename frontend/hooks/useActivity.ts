"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Activity } from "@/lib/api";
import { localDay } from "@/lib/eta";

/** Если ни шагов, ни автоперелистывания дольше этого — человек не плетёт (отошёл, отвлёкся). */
export const IDLE_AFTER_MS = 90_000;
/** Перерыв дольше этого сбрасывает «непрерывную работу» для напоминаний. */
export const SESSION_RESET_SEC = 300;
const FLUSH_MS = 30_000;
/** Прыжок через «Перейти к шагу» — не плетение: шаги считаем, только если идём по одному-два. */
const MAX_COUNTED_JUMP = 3;

/**
 * Учёт времени плетения. Активно — когда вкладка открыта и идёт автоперелистывание
 * или недавно был шаг. Раз в 30 с прибавка уходит на сервер (POST /activity).
 */
export function useActivity(projectId: string | undefined, step: number, playing: boolean, initial: Activity | undefined) {
  const [activity, setActivity] = useState<Activity>(initial ?? { total_sec: 0, total_steps: 0, days: [] });
  const [sessionSec, setSessionSec] = useState(0);
  const pending = useRef({ sec: 0, steps: 0 });
  const lastStep = useRef(step);
  const lastMove = useRef(0);
  const idleSec = useRef(0);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  useEffect(() => {
    const delta = step - lastStep.current;
    if (delta !== 0) lastMove.current = Date.now();
    if (delta > 0 && delta <= MAX_COUNTED_JUMP) pending.current.steps += delta;
    lastStep.current = step;
  }, [step]);

  const flush = useCallback(
    (keepalive = false) => {
      const { sec, steps } = pending.current;
      if (!projectId || (sec < 1 && steps === 0)) return;
      pending.current = { sec: 0, steps: 0 };
      api
        .activity(projectId, { date: localDay(), seconds: Math.min(600, Math.round(sec)), steps }, keepalive)
        .then(setActivity)
        .catch(() => {
          pending.current.sec += sec; // не дошло — отправим в следующий раз
          pending.current.steps += steps;
        });
    },
    [projectId],
  );

  useEffect(() => {
    const tick = setInterval(() => {
      const visible = typeof document === "undefined" || document.visibilityState !== "hidden";
      const active = visible && (playingRef.current || Date.now() - lastMove.current < IDLE_AFTER_MS);
      if (active) {
        pending.current.sec += 1;
        idleSec.current = 0;
        setSessionSec((s) => s + 1);
      } else if (++idleSec.current === SESSION_RESET_SEC) {
        setSessionSec(0);
      }
    }, 1000);
    const send = setInterval(() => flush(), FLUSH_MS);
    const onHide = () => document.visibilityState === "hidden" && flush(true);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(tick);
      clearInterval(send);
      document.removeEventListener("visibilitychange", onHide);
      flush(true);
    };
  }, [flush]);

  const resetSession = useCallback(() => setSessionSec(0), []);
  return { activity, sessionSec, resetSession, flush };
}
