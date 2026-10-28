// Компонент работает в браузере
"use client";

// Хуки React
import { useEffect, useRef, useState } from "react";
// Адрес шаблона
import { api } from "@/lib/api";
// Числа по-русски
import { num } from "@/lib/format";
// Таймлапс, открытка, сохранение файла, формат видео
import { recordTimelapse, renderCard, saveBlob, videoFormat } from "@/lib/share";
// Иконки
import { Icon } from "../ui/Icon";

// Имя файла без запрещённых в Windows символов (\ / : * ? " < > |)
const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").trim() || "портрет";

/** Распечатать шаблон, сделать открытку и видео — всё про один портрет. */
// Панель «Распечатать и поделиться»
export function SharePanel({
  // id проекта
  projectId,
  // Название
  name,
  // Последовательность
  sequence,
  // Число линий
  lines,
  // Диаметр
  diameterCm,
  // Длина лески, м
  threadM,
  // Сохранить несохранённые изменения перед скачиванием
  beforeDownload,
// Типы свойств
}: {
  // id
  projectId: string;
  // Название
  name: string;
  // Последовательность
  sequence: readonly number[];
  // Линии
  lines: number;
  // Диаметр
  diameterCm: number;
  // Леска
  threadM: number;
  // Функция сохранения
  beforeDownload: () => Promise<void>;
// Тело компонента
}) {
  // Формат бумаги шаблона
  const [paper, setPaper] = useState<"A4" | "A3">("A4");
  // Подпись открытки и видео
  const [caption, setCaption] = useState("");
  // Готовая открытка (адрес для показа и файл)
  const [card, setCard] = useState<{ url: string; blob: Blob } | null>(null);
  // Открытка рисуется
  const [cardBusy, setCardBusy] = useState(false);
  // Длина видео, с
  const [videoSec, setVideoSec] = useState(20);
  // Прогресс записи (null — не пишем)
  const [progress, setProgress] = useState<number | null>(null);
  // Готовое видео
  const [video, setVideo] = useState<{ url: string; blob: Blob; ext: string } | null>(null);
  // Ошибка
  const [error, setError] = useState("");
  // Умеет ли браузер записывать видео
  const [canRecord, setCanRecord] = useState(true);
  // Управление отменой записи
  const abort = useRef<AbortController | null>(null);

  // Проверяем запись видео (только в браузере)
  useEffect(() => setCanRecord(videoFormat() !== null), []);
  // При уходе со страницы — остановить запись
  useEffect(() => () => abort.current?.abort(), []);
  // Старую открытку освобождаем из памяти при замене
  useEffect(() => () => void (card && URL.revokeObjectURL(card.url)), [card]);
  // Старое видео — тоже
  useEffect(() => () => void (video && URL.revokeObjectURL(video.url)), [video]);

  // Скачать шаблон
  const downloadTemplate = async () => {
    // Сначала сохраняем диаметр
    await beforeDownload(); // диаметр мог только что поменяться
    // Временная ссылка
    const a = document.createElement("a");
    // Адрес шаблона нужного формата
    a.href = api.templateUrl(projectId, paper);
    // В документ
    document.body.appendChild(a);
    // «Нажать» — скачивание (имя файла отдаёт сервер)
    a.click();
    // Убрать ссылку
    a.remove();
  };

  // Сделать открытку
  const makeCard = async () => {
    // Рисуем
    setCardBusy(true);
    // Сброс ошибки
    setError("");
    // Ошибки ловим
    try {
      // Рисуем PNG
      const blob = await renderCard({ sequence, lines, diameterCm, caption, title: name, threadM });
      // Показываем
      setCard({ blob, url: URL.createObjectURL(blob) });
    // Ошибка
    } catch (e) {
      // Текст
      setError(e instanceof Error ? e.message : "Не получилось нарисовать открытку.");
    // В любом случае
    } finally {
      // Больше не рисуем
      setCardBusy(false);
    }
  };

  // Поделиться открыткой
  const shareCard = async () => {
    // Нет открытки
    if (!card) return;
    // Файл из картинки
    const file = new File([card.blob], `${fileSafe(name)}.png`, { type: "image/png" });
    // Телефон умеет делиться файлами (меню «Поделиться»)
    if (navigator.canShare?.({ files: [file] })) {
      // Открываем меню; отмену игнорируем
      await navigator.share({ files: [file], title: caption || name }).catch(() => undefined);
    // Иначе — просто скачиваем
    } else saveBlob(card.blob, file.name);
  };

  // Записать видео
  const makeVideo = async () => {
    // Сброс ошибки
    setError("");
    // Сброс прошлого видео
    setVideo(null);
    // Прогресс 0
    setProgress(0);
    // Новый контроллер отмены
    abort.current = new AbortController();
    // Ошибки ловим
    try {
      // Запись
      const { blob, ext } = await recordTimelapse({
        // Последовательность
        sequence,
        // Линии
        lines,
        // Диаметр
        diameterCm,
        // Подпись или название в конце ролика
        title: caption.trim() || name,
        // Длина
        seconds: videoSec,
        // Прогресс
        onProgress: setProgress,
        // Сигнал отмены
        signal: abort.current.signal,
      });
      // Показываем готовое видео
      setVideo({ blob, ext, url: URL.createObjectURL(blob) });
    // Ошибка
    } catch (e) {
      // Остановка кнопкой — не ошибка
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        // Остальное — показываем
        setError(e instanceof Error ? e.message : "Не получилось записать видео.");
      }
    // В любом случае
    } finally {
      // Прогресс скрыть
      setProgress(null);
    }
  };

  // Разметка
  return (
    // Панель
    <div className="share-panel">
      {/* Блок «шаблон» */}
      <div className="share-block">
        {/* Заголовок */}
        <h3>
          {/* Иконка и текст */}
          <Icon name="ruler" size={18} /> Шаблон разметки гвоздей
        </h3>
        {/* Пояснение */}
        <p className="hint">
          {/* Текст */}
          Круг в натуральную величину на листах: распечатать, склеить, приложить к доске и вбить гвозди в крестики.
        </p>
        {/* Ряд управления */}
        <div className="share-row">
          {/* Выбор бумаги */}
          <div className="segmented" role="radiogroup" aria-label="Бумага">
            {/* Кнопка на каждый формат */}
            {(["A4", "A3"] as const).map((p) => (
              // Кнопка-переключатель
              <button key={p} type="button" role="radio" className="seg" aria-checked={paper === p} onClick={() => setPaper(p)}>
                {/* «A4» */}
                {p}
              </button>
            ))}
          </div>
          {/* Кнопка скачивания */}
          <button type="button" className="btn secondary" onClick={downloadTemplate} data-testid="download-template">
            {/* Иконка */}
            <Icon name="download" size={18} />
            {/* Надпись */}
            Скачать шаблон PDF
          </button>
        </div>
      </div>

      {/* Блок «открытка и видео» */}
      <div className="share-block">
        {/* Заголовок */}
        <h3>
          {/* Иконка и текст */}
          <Icon name="gift" size={18} /> Открытка и видео
        </h3>
        {/* Поле подписи */}
        <label className="field">
          {/* Подпись поля */}
          <span>Подпись</span>
          {/* Текстовое поле */}
          <input
            // Тип
            type="text"
            // Не длиннее 60 символов (иначе не влезет)
            maxLength={60}
            // Подсказка с названием портрета
            placeholder={`например, «${name} — с любовью»`}
            // Значение
            value={caption}
            // Ввод
            onChange={(e) => setCaption(e.target.value)}
          />
        </label>
        {/* Ряд */}
        <div className="share-row">
          {/* Кнопка «сделать открытку» (неактивна, пока рисуется) */}
          <button type="button" className="btn secondary" onClick={makeCard} disabled={cardBusy} data-testid="make-card">
            {/* Иконка */}
            <Icon name="gift" size={18} />
            {/* Надпись меняется на время работы */}
            {cardBusy ? "Рисуем…" : "Сделать открытку"}
          </button>
        </div>
        {/* Готовая открытка */}
        {card && (
          // Блок результата
          <div className="share-result" data-testid="card-result">
            {/* Отключаем правило линтера (картинка — из памяти браузера) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {/* Открытка */}
            <img src={card.url} alt="Открытка с портретом" />
            {/* Кнопки */}
            <div className="share-row">
              {/* Скачать PNG */}
              <button type="button" className="btn primary small" onClick={() => saveBlob(card.blob, `${fileSafe(name)}.png`)}>
                {/* Иконка */}
                <Icon name="download" size={16} />
                {/* Надпись */}
                Скачать PNG
              </button>
              {/* Поделиться */}
              <button type="button" className="btn ghost small" onClick={shareCard}>
                {/* Надпись */}
                Поделиться
              </button>
            </div>
          </div>
        )}

        {/* Ряд видео */}
        <div className="share-row">
          {/* Выбор длины */}
          <div className="segmented" role="radiogroup" aria-label="Длина видео">
            {/* Кнопка на каждый вариант */}
            {[10, 20, 30].map((s) => (
              // Кнопка-переключатель
              <button key={s} type="button" role="radio" className="seg" aria-checked={videoSec === s} onClick={() => setVideoSec(s)}>
                {/* «20 с» */}
                {s} с
              </button>
            ))}
          </div>
          {/* Не пишем — кнопка записи, пишем — кнопка остановки */}
          {progress === null ? (
            // Кнопка записи (неактивна, если браузер не умеет)
            <button type="button" className="btn secondary" onClick={makeVideo} disabled={!canRecord} data-testid="make-video">
              {/* Иконка */}
              <Icon name="camera" size={18} />
              {/* Надпись */}
              Записать таймлапс
            </button>
          // Иначе
          ) : (
            // Кнопка остановки
            <button type="button" className="btn ghost" onClick={() => abort.current?.abort()}>
              {/* Надпись */}
              Остановить
            </button>
          )}
        </div>
        {/* Прогресс записи */}
        {progress !== null && (
          // Блок прогресса
          <div className="video-progress" data-testid="video-progress">
            {/* Полоса прогресса (роль progressbar — для экранного диктора) */}
            <div className="bar" role="progressbar" aria-label="Запись видео" aria-valuenow={Math.round(progress * 100)}>
              {/* Заполненная часть */}
              <span style={{ width: `${progress * 100}%` }} />
            </div>
            {/* Проценты и предупреждение (свёрнутое окно браузер может «усыпить») */}
            <small className="muted">Записываем {num(Math.round(progress * 100))} % — не сворачивайте окно.</small>
          </div>
        )}
        {/* Браузер не умеет записывать */}
        {!canRecord && <small className="muted">Этот браузер не умеет записывать видео — откройте в Chrome, Edge или Яндекс Браузере.</small>}
        {/* Готовое видео */}
        {video && (
          // Блок результата
          <div className="share-result" data-testid="video-result">
            {/* Плеер: без звука, по кругу, внутри страницы на iPhone */}
            <video src={video.url} controls playsInline muted loop />
            {/* Кнопка скачивания */}
            <button
              // Тип
              type="button"
              // Стиль
              className="btn primary small"
              // Сохранить с понятным именем
              onClick={() => saveBlob(video.blob, `${fileSafe(name)} — таймлапс.${video.ext}`)}
            >
              {/* Иконка */}
              <Icon name="download" size={16} />
              {/* Надпись с форматом и размером файла */}
              Скачать видео ({video.ext.toUpperCase()}, {num(video.blob.size / 1024 / 1024, 1)} МБ)
            </button>
          </div>
        )}
        {/* Ошибка */}
        {error && (
          // Абзац
          <p className="form-error" role="alert">
            {/* Текст ошибки */}
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
