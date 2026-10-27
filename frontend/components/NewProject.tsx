"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { useAutoPrep, usePhotoEditor } from "@/hooks/usePhotoEditor";
import { routes } from "@/lib/routes";
import { api, ApiError, type Features, type ImageInfo } from "@/lib/api";
import { DEFAULT_DIAMETER_CM } from "@/lib/constants";
import { downscaleImage } from "@/lib/image";
import { DEFAULT_PREP } from "@/lib/prep";
import { DiameterPicker } from "./DiameterPicker";
import { NailRing } from "./NailRing";
import { PhotoControls, PhotoViewport } from "./PhotoEditor";
import { Icon } from "./ui/Icon";

const ACCEPT = "image/jpeg,image/png,image/webp,image/bmp,image/gif,image/tiff";

export function NewProject() {
  const router = useRouter();
  const inputId = useId();
  const [info, setInfo] = useState<ImageInfo | null>(null);
  const [features, setFeatures] = useState<Features | null>(null);
  const [fileName, setFileName] = useState("");
  const [name, setName] = useState("");
  const [diameter, setDiameter] = useState(DEFAULT_DIAMETER_CM);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<"pick" | "uploading" | "edit" | "creating">("pick");
  const [error, setError] = useState("");
  const editor = usePhotoEditor(info);
  const auto = useAutoPrep(info, features, editor, diameter);

  useEffect(() => {
    api.features().then(setFeatures).catch(() => setFeatures(null));
  }, []);

  const pick = async (f: File | undefined) => {
    setError("");
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("Это не изображение. Подойдут JPEG, PNG, WEBP.");
      return;
    }
    setStage("uploading");
    setFileName(f.name.replace(/\.[^.]+$/, ""));
    try {
      const blob = await downscaleImage(f);
      const uploaded = await api.uploadImage(blob, f.name);
      setInfo(uploaded);
      editor.setPrep({ ...DEFAULT_PREP });
      setStage("edit");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не получилось загрузить фото. Попробуйте другое.");
      setStage("pick");
    }
  };

  const submit = async () => {
    if (!info) return;
    setStage("creating");
    setError("");
    try {
      await editor.flushMask(); // правки фона кистью должны дойти до сервера
      const project = await api.createFromImage({
        image_id: info.id,
        name: name || fileName,
        diameter_cm: diameter,
        prep: editor.prep,
      });
      router.push(routes.project(project.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не получилось создать портрет. Попробуйте другое фото.");
      setStage("edit");
    }
  };

  const reset = () => {
    setInfo(null);
    setStage("pick");
    setError("");
  };

  const busy = stage === "uploading" || stage === "creating";

  return (
    <section className="new-project" aria-labelledby="new-title">
      {info && stage !== "uploading" ? (
        <PhotoViewport
          info={info}
          image={editor.image}
          imageError={editor.imageError}
          mask={editor.mask}
          maskVersion={editor.maskVersion}
          brush={{ ...editor.brush, tool: editor.tool, size: editor.brushSize }}
          prep={editor.prep}
          onChange={editor.setPrep}
        />
      ) : (
        <label
          htmlFor={inputId}
          className={`drop ${dragging ? "is-drag" : ""} ${busy ? "is-busy" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void pick(e.dataTransfer.files[0]);
          }}
        >
          <NailRing className="drop-ring" />
          <span className="drop-text">
            <Icon name="image" size={28} />
            {stage === "uploading" ? "Загружаем фото…" : "Перетащите фото в круг"}
            {stage !== "uploading" && <small>или нажмите, чтобы выбрать файл</small>}
          </span>
          <input
            id={inputId}
            type="file"
            accept={ACCEPT}
            className="visually-hidden"
            data-testid="file-input"
            onChange={(e) => void pick(e.target.files?.[0])}
            disabled={busy}
          />
        </label>
      )}

      <div className="inspector new-form">
        <h1 id="new-title">{info ? "Настройте фото" : "Портрет из нитей по вашему фото"}</h1>
        {!info && (
          <p className="lead">
            Загрузите снимок — приложение рассчитает, как натянуть чёрную леску на 240 гвоздей, чтобы получился
            портрет, и проведёт по каждому шагу.
          </p>
        )}

        <div className="field">
          <label htmlFor="project-name">Название</label>
          <input
            id="project-name"
            type="text"
            maxLength={100}
            placeholder={fileName || "например, Бабушка"}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <DiameterPicker value={diameter} onChange={setDiameter} id="new-diameter" />

        {info && (
          <PhotoControls
            info={info}
            features={features}
            prep={editor.prep}
            onChange={editor.setPrep}
            maskStatus={editor.maskStatus}
            maskError={editor.maskError}
            maskNote={editor.maskNote}
            brush={{
              tool: editor.tool,
              setTool: editor.setTool,
              size: editor.brushSize,
              setSize: editor.setBrushSize,
              canUndo: editor.canUndo,
              undo: editor.undo,
              edited: editor.maskEdited,
              reset: () => void editor.resetMask(),
            }}
            auto={auto}
          />
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="new-actions">
          <button
            type="button"
            className="btn primary"
            onClick={submit}
            disabled={!info || busy || editor.maskStatus === "loading" || auto.busy}
          >
            <Icon name="sparkle" size={18} />
            {stage === "creating" ? "Считаем линии…" : "Сделать портрет"}
          </button>
          {info && !busy && (
            <button type="button" className="btn secondary" onClick={reset}>
              Другое фото
            </button>
          )}
        </div>
        {stage === "creating" && <p className="muted">Обычно это занимает пару секунд.</p>}
      </div>
    </section>
  );
}
