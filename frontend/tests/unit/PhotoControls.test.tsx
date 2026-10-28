// Отрисовка, поиск и события
import { fireEvent, render, screen } from "@testing-library/react";
// Описание тестов, проверки, шпионы
import { describe, expect, it, vi } from "vitest";
// Тестируемый компонент — панель ползунков и галочек редактора фото
import { PhotoControls } from "@/components/PhotoEditor";
// Тип описания картинки
import type { ImageInfo } from "@/lib/api";
// Параметры по умолчанию
import { DEFAULT_PREP } from "@/lib/prep";

// Картинка, на которой нашлось лицо
const withFace: ImageInfo = {
  // id
  id: "abcabcabcabc",
  // ширина
  width: 1000,
  // высота
  height: 800,
  // одно лицо
  faces: [{ x: 0.4, y: 0.2, w: 0.2, h: 0.25 }],
  // маски фона ещё нет
  has_mask: false,
  // готовый кадр «Выделить лицо»
  face_prep: { ...DEFAULT_PREP, center_x: 0.5, center_y: 0.35, zoom: 1.33, face_focus: true },
};
// Та же картинка без лица
const noFace: ImageInfo = { ...withFace, faces: [], face_prep: null };
// Сервер умеет и искать лица, и удалять фон
const allFeatures = { face_detection: true, background_removal: true };

// Помощник: рисует панель с нужными данными и отдаёт шпион onChange
function setup(info = withFace, features = allFeatures, prep = DEFAULT_PREP, maskStatus = "idle" as const) {
  // Шпион
  const onChange = vi.fn();
  // Рисуем
  render(
    // Панель со всеми нужными свойствами
    <PhotoControls info={info} features={features} prep={prep} onChange={onChange} maskStatus={maskStatus} maskError="" />,
  );
  // Отдаём шпион
  return onChange;
}

// Группа тестов панели
describe("PhotoControls", () => {
  // Три ползунка меняют свои параметры
  it("ползунки масштаба, яркости и контраста", () => {
    // Рисуем
    const onChange = setup();
    // Масштаб 2,5
    fireEvent.change(screen.getByRole("slider", { name: "Масштаб" }), { target: { value: "2.5" } });
    // Сообщили зум 2,5
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_PREP, zoom: 2.5 });
    // Яркость 0,2
    fireEvent.change(screen.getByRole("slider", { name: "Яркость" }), { target: { value: "0.2" } });
    // Сообщили яркость
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_PREP, brightness: 0.2 });
    // Контраст −0,3
    fireEvent.change(screen.getByRole("slider", { name: "Контраст" }), { target: { value: "-0.3" } });
    // Сообщили контраст
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_PREP, contrast: -0.3 });
  });

  // Подписи значений по-русски
  it("показывает значения в процентах и кратности", () => {
    // Рисуем с зумом 2, яркостью +15 %, контрастом −20 %
    setup(withFace, allFeatures, { ...DEFAULT_PREP, zoom: 2, brightness: 0.15, contrast: -0.2 });
    // Зум
    expect(screen.getByText("×2,00")).toBeInTheDocument();
    // Яркость
    expect(screen.getByText("+15 %")).toBeInTheDocument();
    // Контраст
    expect(screen.getByText("-20 %")).toBeInTheDocument();
  });

  // Галочка «Выделить лицо» берёт готовый кадр с сервера
  it("«Выделить лицо» ставит кадр на лицо и включает акцент", () => {
    // Рисуем
    const onChange = setup();
    // Ставим галочку
    fireEvent.click(screen.getByLabelText("Выделить лицо"));
    // Ушли параметры кадра на лицо:
    expect(onChange).toHaveBeenLastCalledWith({
      // остальное по умолчанию,
      ...DEFAULT_PREP,
      // центр по X,
      center_x: 0.5,
      // центр по Y,
      center_y: 0.35,
      // зум,
      zoom: 1.33,
      // и флажок
      face_focus: true,
    });
  });

  // Без лица галочка недоступна и объяснено почему
  it("без лица галочка неактивна и есть подсказка", () => {
    // Рисуем для фото без лица
    setup(noFace);
    // Галочка заблокирована
    expect(screen.getByLabelText("Выделить лицо")).toBeDisabled();
    // Подсказка
    expect(screen.getByText(/Лицо анфас на фото не найдено/)).toBeInTheDocument();
  });

  // Без библиотеки удаления фона галочка недоступна
  it("«Убрать фон» недоступно, если на сервере нет rembg", () => {
    // Сервер не умеет удалять фон
    setup(withFace, { face_detection: true, background_removal: false });
    // Галочка заблокирована
    expect(screen.getByLabelText("Убрать фон")).toBeDisabled();
    // Подсказка, какой файл установить
    expect(screen.getByText(/requirements-bg\.txt/)).toBeInTheDocument();
  });

  // Пока маска считается — галочку не нажать, а статус виден
  it("пока считается маска, галочка заблокирована и показан статус с сервера", () => {
    // Шпион
    const onChange = vi.fn();
    // Рисуем
    render(
      // Панель с состоянием загрузки маски
      <PhotoControls
        // описание картинки
        info={withFace}
        // возможности сервера
        features={allFeatures}
        // удаление фона включено
        prep={{ ...DEFAULT_PREP, remove_background: true }}
        // шпион
        onChange={onChange}
        // маска считается
        maskStatus="loading"
        // ошибки нет
        maskError=""
        // текст статуса с сервера
        maskNote="Загружаем модель удаления фона…"
      />,
    );
    // Галочка заблокирована
    expect(screen.getByLabelText("Убрать фон")).toBeDisabled();
    // Статус показан
    expect(screen.getByText("Загружаем модель удаления фона…")).toBeInTheDocument();
  });

  // Ошибка удаления фона видна, а галочку можно нажать снова
  it("ошибку удаления фона видно", () => {
    // Шпион
    const onChange = vi.fn();
    // Рисуем
    render(
      // Панель с ошибкой
      <PhotoControls
        // описание картинки
        info={withFace}
        // возможности сервера
        features={allFeatures}
        // параметры по умолчанию
        prep={DEFAULT_PREP}
        // шпион
        onChange={onChange}
        // состояние «ошибка»
        maskStatus="error"
        // текст ошибки
        maskError="Не удалось загрузить модель удаления фона: нет сети"
      />,
    );
    // Ошибка — в элементе alert
    expect(screen.getByRole("alert")).toHaveTextContent("нет сети");
    // Галочка доступна, чтобы попробовать ещё раз
    expect(screen.getByLabelText("Убрать фон")).not.toBeDisabled();
  });

  // Кнопки сброса
  it("сброс", () => {
    // Рисуем с изменёнными кадром и яркостью
    const onChange = setup(withFace, allFeatures, { ...DEFAULT_PREP, zoom: 3, brightness: 0.3, center_x: 0.2 });
    // «Кадр по центру»
    fireEvent.click(screen.getByRole("button", { name: "Кадр по центру" }));
    // Сбросился только кадр, яркость осталась
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_PREP, brightness: 0.3 });
    // «Сбросить всё»
    fireEvent.click(screen.getByRole("button", { name: "Сбросить всё" }));
    // Всё по умолчанию
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_PREP);
  });
});
