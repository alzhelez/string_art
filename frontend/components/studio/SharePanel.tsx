"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { num } from "@/lib/format";
import { recordTimelapse, renderCard, saveBlob, videoFormat } from "@/lib/share";
import { Icon } from "../ui/Icon";

const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").trim() || "портрет";

/** Распечатать шаблон, сделать открытку и видео — всё про один портрет. */
export function SharePanel({
  projectId,
  name,
  sequence,
  lines,
  diameterCm,
  threadM,
  beforeDownload,
}: {
  projectId: string;
  name: string;
  sequence: readonly number[];
  lines: number;
  diameterCm: number;
  threadM: number;
  beforeDownload: () => Promise<void>;
}) {
  const [paper, setPaper] = useState<"A4" | "A3">("A4");
  const [caption, setCaption] = useState("");
  const [card, setCard] = useState<{ url: string; blob: Blob } | null>(null);
  const [cardBusy, setCardBusy] = useState(false);
  const [videoSec, setVideoSec] = useState(20);
  const [progress, setProgress] = useState<number | null>(null);
  const [video, setVideo] = useState<{ url: string; blob: Blob; ext: string } | null>(null);
  const [error, setError] = useState("");
  const [canRecord, setCanRecord] = useState(true);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => setCanRecord(videoFormat() !== null), []);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => () => void (card && URL.revokeObjectURL(card.url)), [card]);
  useEffect(() => () => void (video && URL.revokeObjectURL(video.url)), [video]);

  const downloadTemplate = async () => {
    await beforeDownload(); // диаметр мог только что поменяться
    const a = document.createElement("a");
    a.href = api.templateUrl(projectId, paper);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const makeCard = async () => {
    setCardBusy(true);
    setError("");
    try {
      const blob = await renderCard({ sequence, lines, diameterCm, caption, title: name, threadM });
      setCard({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось нарисовать открытку.");
    } finally {
      setCardBusy(false);
    }
  };

  const shareCard = async () => {
    if (!card) return;
    const file = new File([card.blob], `${fileSafe(name)}.png`, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: caption || name }).catch(() => undefined);
    } else saveBlob(card.blob, file.name);
  };

  const makeVideo = async () => {
    setError("");
    setVideo(null);
    setProgress(0);
    abort.current = new AbortController();
    try {
      const { blob, ext } = await recordTimelapse({
        sequence,
        lines,
        diameterCm,
        title: caption.trim() || name,
        seconds: videoSec,
        onProgress: setProgress,
        signal: abort.current.signal,
      });
      setVideo({ blob, ext, url: URL.createObjectURL(blob) });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : "Не получилось записать видео.");
      }
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="share-panel">
      <div className="share-block">
        <h3>
          <Icon name="ruler" size={18} /> Шаблон разметки гвоздей
        </h3>
        <p className="hint">
          Круг в натуральную величину на листах: распечатать, склеить, приложить к доске и вбить гвозди в крестики.
        </p>
        <div className="share-row">
          <div className="segmented" role="radiogroup" aria-label="Бумага">
            {(["A4", "A3"] as const).map((p) => (
              <button key={p} type="button" role="radio" className="seg" aria-checked={paper === p} onClick={() => setPaper(p)}>
                {p}
              </button>
            ))}
          </div>
          <button type="button" className="btn secondary" onClick={downloadTemplate} data-testid="download-template">
            <Icon name="download" size={18} />
            Скачать шаблон PDF
          </button>
        </div>
      </div>

      <div className="share-block">
        <h3>
          <Icon name="gift" size={18} /> Открытка и видео
        </h3>
        <label className="field">
          <span>Подпись</span>
          <input
            type="text"
            maxLength={60}
            placeholder={`например, «${name} — с любовью»`}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
        </label>
        <div className="share-row">
          <button type="button" className="btn secondary" onClick={makeCard} disabled={cardBusy} data-testid="make-card">
            <Icon name="gift" size={18} />
            {cardBusy ? "Рисуем…" : "Сделать открытку"}
          </button>
        </div>
        {card && (
          <div className="share-result" data-testid="card-result">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={card.url} alt="Открытка с портретом" />
            <div className="share-row">
              <button type="button" className="btn primary small" onClick={() => saveBlob(card.blob, `${fileSafe(name)}.png`)}>
                <Icon name="download" size={16} />
                Скачать PNG
              </button>
              <button type="button" className="btn ghost small" onClick={shareCard}>
                Поделиться
              </button>
            </div>
          </div>
        )}

        <div className="share-row">
          <div className="segmented" role="radiogroup" aria-label="Длина видео">
            {[10, 20, 30].map((s) => (
              <button key={s} type="button" role="radio" className="seg" aria-checked={videoSec === s} onClick={() => setVideoSec(s)}>
                {s} с
              </button>
            ))}
          </div>
          {progress === null ? (
            <button type="button" className="btn secondary" onClick={makeVideo} disabled={!canRecord} data-testid="make-video">
              <Icon name="camera" size={18} />
              Записать таймлапс
            </button>
          ) : (
            <button type="button" className="btn ghost" onClick={() => abort.current?.abort()}>
              Остановить
            </button>
          )}
        </div>
        {progress !== null && (
          <div className="video-progress" data-testid="video-progress">
            <div className="bar" role="progressbar" aria-label="Запись видео" aria-valuenow={Math.round(progress * 100)}>
              <span style={{ width: `${progress * 100}%` }} />
            </div>
            <small className="muted">Записываем {num(Math.round(progress * 100))} % — не сворачивайте окно.</small>
          </div>
        )}
        {!canRecord && <small className="muted">Этот браузер не умеет записывать видео — откройте в Chrome, Edge или Яндекс Браузере.</small>}
        {video && (
          <div className="share-result" data-testid="video-result">
            <video src={video.url} controls playsInline muted loop />
            <button
              type="button"
              className="btn primary small"
              onClick={() => saveBlob(video.blob, `${fileSafe(name)} — таймлапс.${video.ext}`)}
            >
              <Icon name="download" size={16} />
              Скачать видео ({video.ext.toUpperCase()}, {num(video.blob.size / 1024 / 1024, 1)} МБ)
            </button>
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
