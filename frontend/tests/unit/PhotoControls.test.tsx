import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PhotoControls } from "@/components/PhotoEditor";
import type { ImageInfo } from "@/lib/api";
import { DEFAULT_PREP } from "@/lib/prep";

const withFace: ImageInfo = {
  id: "abcabcabcabc",
  width: 1000,
  height: 800,
  faces: [{ x: 0.4, y: 0.2, w: 0.2, h: 0.25 }],
  has_mask: false,
  face_prep: { ...DEFAULT_PREP, center_x: 0.5, center_y: 0.35, zoom: 1.33, face_focus: true },
};
const noFace: ImageInfo = { ...withFace, faces: [], face_prep: null };
const allFeatures = { face_detection: true, background_removal: true };

function setup(info = withFace, features = allFeatures, prep = DEFAULT_PREP, maskStatus = "idle" as const) {
  const onChange = vi.fn();
  render(
    <PhotoControls info={info} features={features} prep={prep} onChange={onChange} maskStatus={maskStatus} maskError="" />,
  );
  return onChange;
}

describe("PhotoControls", () => {
  it("ползунки масштаба, яркости и контраста", () => {
    const onChange = setup();
    fireEvent.change(screen.getByRole("slider", { name: "Масштаб" }), { target: { value: "2.5" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_PREP, zoom: 2.5 });
    fireEvent.change(screen.getByRole("slider", { name: "Яркость" }), { target: { value: "0.2" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_PREP, brightness: 0.2 });
    fireEvent.change(screen.getByRole("slider", { name: "Контраст" }), { target: { value: "-0.3" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_PREP, contrast: -0.3 });
  });

  it("показывает значения в процентах и кратности", () => {
    setup(withFace, allFeatures, { ...DEFAULT_PREP, zoom: 2, brightness: 0.15, contrast: -0.2 });
    expect(screen.getByText("×2,00")).toBeInTheDocument();
    expect(screen.getByText("+15 %")).toBeInTheDocument();
    expect(screen.getByText("-20 %")).toBeInTheDocument();
  });

  it("«Выделить лицо» ставит кадр на лицо и включает акцент", () => {
    const onChange = setup();
    fireEvent.click(screen.getByLabelText("Выделить лицо"));
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_PREP,
      center_x: 0.5,
      center_y: 0.35,
      zoom: 1.33,
      face_focus: true,
    });
  });

  it("без лица галочка неактивна и есть подсказка", () => {
    setup(noFace);
    expect(screen.getByLabelText("Выделить лицо")).toBeDisabled();
    expect(screen.getByText(/Лицо анфас на фото не найдено/)).toBeInTheDocument();
  });

  it("«Убрать фон» недоступно, если на сервере нет rembg", () => {
    setup(withFace, { face_detection: true, background_removal: false });
    expect(screen.getByLabelText("Убрать фон")).toBeDisabled();
    expect(screen.getByText(/requirements-bg\.txt/)).toBeInTheDocument();
  });

  it("пока считается маска, галочка заблокирована и показан статус с сервера", () => {
    const onChange = vi.fn();
    render(
      <PhotoControls
        info={withFace}
        features={allFeatures}
        prep={{ ...DEFAULT_PREP, remove_background: true }}
        onChange={onChange}
        maskStatus="loading"
        maskError=""
        maskNote="Загружаем модель удаления фона…"
      />,
    );
    expect(screen.getByLabelText("Убрать фон")).toBeDisabled();
    expect(screen.getByText("Загружаем модель удаления фона…")).toBeInTheDocument();
  });

  it("ошибку удаления фона видно", () => {
    const onChange = vi.fn();
    render(
      <PhotoControls
        info={withFace}
        features={allFeatures}
        prep={DEFAULT_PREP}
        onChange={onChange}
        maskStatus="error"
        maskError="Не удалось загрузить модель удаления фона: нет сети"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("нет сети");
    expect(screen.getByLabelText("Убрать фон")).not.toBeDisabled();
  });

  it("сброс", () => {
    const onChange = setup(withFace, allFeatures, { ...DEFAULT_PREP, zoom: 3, brightness: 0.3, center_x: 0.2 });
    fireEvent.click(screen.getByRole("button", { name: "Кадр по центру" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_PREP, brightness: 0.3 });
    fireEvent.click(screen.getByRole("button", { name: "Сбросить всё" }));
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_PREP);
  });
});
