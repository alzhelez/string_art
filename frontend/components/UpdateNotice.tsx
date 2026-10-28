// Компонент работает в браузере
"use client";

// Состояние и эффекты React
import { useEffect, useState } from "react";
// Запросы к бэкенду и тип состояния обновления
import { api, type UpdateStatus } from "@/lib/api";
// Проверка обновлений: «отложено», сравнение версий, последний релиз
import { dismiss, isDismissed, isNewer, latestRelease, type Release } from "@/lib/update";
// Значки
import { Icon } from "./ui/Icon";

// Как часто спрашивать сервер о ходе обновления, мс
export const UPDATE_POLL_MS = 700;

// Шаги, на которых обновление ещё идёт
const ACTIVE = new Set(["checking", "downloading", "verifying", "installing"]);

// Мегабайты одной цифрой после запятой
function mb(bytes: number): string {
  // Байты → МБ, запятая по-русски
  return (bytes / 1024 / 1024).toFixed(1).replace(".", ",");
}

/** Что сейчас происходит с обновлением — текст для человека. */
// Текст хода обновления
export function updateText(s: UpdateStatus): string {
  // Узнаём релиз
  if (s.state === "checking") return "Проверяем последнюю версию на GitHub…";
  // Качаем: проценты и мегабайты, если размер известен
  if (s.state === "downloading")
    // Размер известен — проценты
    return s.total > 0
      // «Скачиваем 1.4.20: 45 % (34,0 из 76,0 МБ)»
      ? `Скачиваем версию ${s.version}: ${Math.floor((s.done / s.total) * 100)} % (${mb(s.done)} из ${mb(s.total)} МБ)`
      // Размер неизвестен — только мегабайты
      : `Скачиваем версию ${s.version}: ${mb(s.done)} МБ`;
  // Сверяем сумму
  if (s.state === "verifying") return "Проверяем, что файл скачался целым…";
  // Установка запущена
  if (s.state === "installing")
    // Программа закроется и откроется снова
    return `Устанавливаем ${s.version}: «Нитеграф» закроется и через полминуты откроется снова. Портреты сохранятся.`;
  // Ошибка — её текст
  return s.error ?? "Обновление не удалось";
}

/** Только в программе для Windows: «вышла новая версия — обновить?». */
// Плашка обновления
export function UpdateNotice() {
  // Найденное обновление (текущая версия, релиз, умеет ли программа обновляться сама) или null
  const [update, setUpdate] = useState<{ current: string; release: Release; oneClick: boolean } | null>(null);
  // Ход обновления в одну кнопку (null — ещё не нажимали)
  const [progress, setProgress] = useState<UpdateStatus | null>(null);

  // Проверяем один раз при открытии
  useEffect(() => {
    // Флаг «компонент ещё на экране» — не обновлять состояние после ухода со страницы
    let alive = true;
    // Асинхронная функция, вызванная сразу
    (async () => {
      // Версия программы (ошибка сети — просто null)
      const app = await api.appInfo().catch(() => null);
      // Не программа для Windows или сборка разработчика — не проверяем
      if (!app?.desktop || app.version === "dev") return;
      // Последний релиз с GitHub (с кэшем на 6 часов)
      const release = await latestRelease();
      // Релиз новее, его не откладывали и компонент ещё жив
      if (alive && release && isNewer(release.version, app.version) && !isDismissed(release.version)) {
        // Показываем плашку
        setUpdate({ current: app.version, release, oneClick: Boolean(app.update) });
      }
    })();
    // При уходе со страницы
    return () => {
      // Помечаем, что компонента больше нет
      alive = false;
    };
    // [] — эффект выполняется один раз, при появлении компонента
  }, []);

  // Пока обновление идёт — опрашиваем сервер
  useEffect(() => {
    // Не идёт — не опрашиваем
    if (!progress || !ACTIVE.has(progress.state)) return;
    // Таймер опроса
    const timer = window.setTimeout(async () => {
      // Сервер может уже закрыться (идёт установка) — тогда оставляем последнее состояние
      const next = await api.updateStatus().catch(() => null);
      // Получили — показываем (а заодно запускаем следующий опрос)
      if (next) setProgress(next);
      // Сервер не ответил — опросим ещё раз, сохранив состояние (новый объект — эффект сработает снова)
      else setProgress((p) => (p ? { ...p } : p));
      // Ждём UPDATE_POLL_MS между опросами
    }, UPDATE_POLL_MS);
    // При смене состояния или уходе — снимаем таймер
    return () => window.clearTimeout(timer);
    // Зависимость — текущее состояние
  }, [progress]);

  // Нажали «Обновить»
  const start = async () => {
    // Сразу показываем «проверяем»
    setProgress({ state: "checking", version: null, done: 0, total: 0, error: null, supported: true });
    // Запрос к серверу
    try {
      // Сервер начал обновление
      setProgress(await api.startUpdate());
      // Сервер отказал
    } catch (e) {
      // Показываем его текст
      setProgress({ state: "error", version: null, done: 0, total: 0, error: (e as Error).message, supported: true });
    }
  };

  // Обновления нет — ничего не рисуем
  if (!update) return null;
  // Обновление идёт (кнопки прячем, чтобы не нажать дважды)
  const busy = progress !== null && ACTIVE.has(progress.state);
  // Плашка
  return (
    // role="status" — экранный диктор озвучит появление и ход обновления
    <div className="update-notice" role="status" data-testid="update-notice">
      {/* Значок загрузки */}
      <Icon name="download" size={18} />
      {/* Текст: что вышло или как идёт обновление */}
      {progress ? (
        // Ход обновления
        <span data-testid="update-progress" className={progress.state === "error" ? "update-error" : undefined}>
          {/* Текст шага */}
          {updateText(progress)}
          {/* Полоса скачивания */}
          {progress.state === "downloading" && progress.total > 0 && (
            // Полоса прогресса
            <progress className="update-bar" max={progress.total} value={progress.done} aria-label="Скачано" />
          )}
        </span>
        // Обновление ещё не начинали
      ) : (
        // Сообщение о новой версии
        <span>
          {/* Номер новой и текущей версии */}
          Вышла новая версия <strong>{update.release.version}</strong> (у вас {update.current}). Портреты при обновлении
          сохранятся.
        </span>
      )}
      {/* Кнопка «Обновить» — если программа умеет обновляться сама и обновление не идёт */}
      {update.oneClick && !busy && (
        // Обычная кнопка
        <button type="button" className="btn primary small" onClick={start} data-testid="update-now">
          {/* После ошибки — «Повторить» */}
          {progress?.state === "error" ? "Повторить" : "Обновить"}
        </button>
      )}
      {/* Ссылка на установщик в новой вкладке (запасной путь); noreferrer — не передавать адрес нашей страницы */}
      {!busy && (
        // Ссылка
        <a className={`btn small ${update.oneClick ? "ghost" : "primary"}`} href={update.release.url} target="_blank" rel="noreferrer">
          {/* Надпись на кнопке */}
          Скачать
        </a>
      )}
      {/* Кнопка «Позже» (пока обновление не началось) */}
      {!busy && (
        // Кнопка
        <button
          // Обычная кнопка (не отправка формы)
          type="button"
          // Стиль — прозрачная маленькая
          className="btn ghost small"
          // По нажатию
          onClick={() => {
            // Запоминаем, что эту версию отложили
            dismiss(update.release.version);
            // Скрываем плашку
            setUpdate(null);
          }}
        >
          {/* Надпись на кнопке */}
          Позже
        </button>
      )}
    </div>
  );
}
