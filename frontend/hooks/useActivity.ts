// Хук работает в браузере
"use client";

// Хуки React
import { useCallback, useEffect, useRef, useState } from "react";
// Запрос отметки времени и тип журнала
import { api, type Activity } from "@/lib/api";
// Местная дата ГГГГ-ММ-ДД
import { localDay } from "@/lib/eta";

/** Если ни шагов, ни автоперелистывания дольше этого — человек не плетёт (отошёл, отвлёкся). */
export const IDLE_AFTER_MS = 90_000;
/** Перерыв дольше этого сбрасывает «непрерывную работу» для напоминаний. */
export const SESSION_RESET_SEC = 300;
// Отправлять накопленное на сервер раз в 30 секунд
const FLUSH_MS = 30_000;
/** Прыжок через «Перейти к шагу» — не плетение: шаги считаем, только если идём по одному-два. */
const MAX_COUNTED_JUMP = 3;

/**
 * Учёт времени плетения. Активно — когда вкладка открыта и идёт автоперелистывание
 * или недавно был шаг. Раз в 30 с прибавка уходит на сервер (POST /activity).
 */
// Хук учёта времени
export function useActivity(projectId: string | undefined, step: number, playing: boolean, initial: Activity | undefined) {
  // Журнал (начальный — из проекта)
  const [activity, setActivity] = useState<Activity>(initial ?? { total_sec: 0, total_steps: 0, days: [] });
  // Сколько секунд плетут без перерыва (для напоминания о перерыве)
  const [sessionSec, setSessionSec] = useState(0);
  // Ещё не отправленные секунды и шаги
  const pending = useRef({ sec: 0, steps: 0 });
  // Предыдущий шаг (чтобы понять, сколько прошли)
  const lastStep = useRef(step);
  // Когда последний раз меняли шаг
  const lastMove = useRef(0);
  // Сколько секунд подряд бездействия
  const idleSec = useRef(0);
  // Свежее значение playing для таймера
  const playingRef = useRef(playing);
  // Обновляем при каждом рендере
  playingRef.current = playing;

  // При смене шага
  useEffect(() => {
    // На сколько шагов сдвинулись
    const delta = step - lastStep.current;
    // Любое движение — признак активности
    if (delta !== 0) lastMove.current = Date.now();
    // Шаги вперёд по одному-три засчитываем (прыжки и шаги назад — нет)
    if (delta > 0 && delta <= MAX_COUNTED_JUMP) pending.current.steps += delta;
    // Запоминаем текущий шаг
    lastStep.current = step;
    // Только при смене шага
  }, [step]);

  // Отправить накопленное
  const flush = useCallback(
    // keepalive — при закрытии вкладки
    (keepalive = false) => {
      // Что накопили
      const { sec, steps } = pending.current;
      // Нечего отправлять
      if (!projectId || (sec < 1 && steps === 0)) return;
      // Обнуляем до отправки (новые секунды копятся уже в новый счёт)
      pending.current = { sec: 0, steps: 0 };
      // Запрос
      api
        // Дата, секунды (не больше 10 минут за раз — так требует API), шаги
        .activity(projectId, { date: localDay(), seconds: Math.min(600, Math.round(sec)), steps }, keepalive)
        // Ответ — обновлённый журнал
        .then(setActivity)
        // Ошибка — возвращаем данные в копилку
        .catch(() => {
          // Секунды
          pending.current.sec += sec; // не дошло — отправим в следующий раз
          // Шаги
          pending.current.steps += steps;
        });
    },
    // Зависимости
    [projectId],
  );

  // Таймеры учёта
  useEffect(() => {
    // Каждую секунду
    const tick = setInterval(() => {
      // Вкладка видна (в тестах document может отсутствовать)
      const visible = typeof document === "undefined" || document.visibilityState !== "hidden";
      // Активность: вкладка видна и идёт автоперелистывание или недавно был шаг
      const active = visible && (playingRef.current || Date.now() - lastMove.current < IDLE_AFTER_MS);
      // Плетут
      if (active) {
        // +1 секунда в копилку
        pending.current.sec += 1;
        // Бездействия нет
        idleSec.current = 0;
        // +1 секунда непрерывной работы
        setSessionSec((s) => s + 1);
        // Не плетут: считаем простой; ровно на 5-й минуте сбрасываем непрерывную работу
      } else if (++idleSec.current === SESSION_RESET_SEC) {
        // Человек отдохнул
        setSessionSec(0);
      }
      // Интервал — 1000 мс
    }, 1000);
    // Раз в 30 секунд — отправка
    const send = setInterval(() => flush(), FLUSH_MS);
    // Вкладку скрыли — сразу отправляем
    const onHide = () => document.visibilityState === "hidden" && flush(true);
    // Подписка на смену видимости
    document.addEventListener("visibilitychange", onHide);
    // При уходе со страницы
    return () => {
      // Остановить секундный таймер
      clearInterval(tick);
      // Остановить отправку
      clearInterval(send);
      // Отписаться
      document.removeEventListener("visibilitychange", onHide);
      // Отправить остатки
      flush(true);
    };
    // Перезапуск при смене flush
  }, [flush]);

  // Сбросить счёт непрерывной работы (после перерыва)
  const resetSession = useCallback(() => setSessionSec(0), []);
  // Наружу
  return { activity, sessionSec, resetSession, flush };
}
