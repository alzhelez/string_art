// render рисует компонент в jsdom, screen ищет элементы как пользователь
import { render, screen } from "@testing-library/react";
// Функции описания тестов и проверки
import { describe, expect, it } from "vitest";
// Тестируемый компонент — окно кадра в редакторе фото
import { PhotoViewport } from "@/components/PhotoEditor";
// Тип описания картинки с сервера
import type { ImageInfo } from "@/lib/api";
// Параметры кадра по умолчанию
import { DEFAULT_PREP } from "@/lib/prep";

// Минимальное описание картинки 512×512 без лиц
const info = { id: "img1", width: 512, height: 512, faces: [], face_prep: null } as unknown as ImageInfo;

// Группа: состояние, пока фото ещё не пришло
describe("PhotoViewport — пока фото грузится", () => {
  // Надпись загрузки — это статус, а не кнопка, и не мешает тянуть кадр
  it("надпись «Загружаем фото…» не перехватывает мышь", () => {
    // Рисуем окно без картинки
    render(<PhotoViewport info={info} image={null} mask={null} prep={{ ...DEFAULT_PREP }} onChange={() => {}} />);
    // Ищем элемент с ролью status
    const label = screen.getByRole("status");
    // В нём текст про загрузку
    expect(label).toHaveTextContent("Загружаем фото…");
    // Класс, у которого в CSS отключены события мыши
    expect(label).toHaveClass("editor-loading");
  });

  // При ошибке загрузки показываем сообщение
  it("если фото не загрузилось — говорит об этом, а не грузится вечно", () => {
    // Рисуем окно с флажком imageError
    render(<PhotoViewport info={info} image={null} imageError mask={null} prep={{ ...DEFAULT_PREP }} onChange={() => {}} />);
    // Сообщение об ошибке — роль alert
    expect(screen.getByRole("alert")).toHaveTextContent("Не удалось загрузить фото");
    // Надписи «Загружаем…» больше нет
    expect(screen.queryByText("Загружаем фото…")).toBeNull();
  });
});
