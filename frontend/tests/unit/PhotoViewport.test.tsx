import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PhotoViewport } from "@/components/PhotoEditor";
import type { ImageInfo } from "@/lib/api";
import { DEFAULT_PREP } from "@/lib/prep";

const info = { id: "img1", width: 512, height: 512, faces: [], face_prep: null } as unknown as ImageInfo;

describe("PhotoViewport — пока фото грузится", () => {
  it("надпись «Загружаем фото…» не перехватывает мышь", () => {
    render(<PhotoViewport info={info} image={null} mask={null} prep={{ ...DEFAULT_PREP }} onChange={() => {}} />);
    const label = screen.getByRole("status");
    expect(label).toHaveTextContent("Загружаем фото…");
    expect(label).toHaveClass("editor-loading");
  });

  it("если фото не загрузилось — говорит об этом, а не грузится вечно", () => {
    render(<PhotoViewport info={info} image={null} imageError mask={null} prep={{ ...DEFAULT_PREP }} onChange={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Не удалось загрузить фото");
    expect(screen.queryByText("Загружаем фото…")).toBeNull();
  });
});
