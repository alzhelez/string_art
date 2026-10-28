// fireEvent — клики и ввод, render и screen — отрисовка и поиск
import { fireEvent, render, screen } from "@testing-library/react";
// Описание тестов, проверки и шпионы
import { describe, expect, it, vi } from "vitest";
// Тестируемый компонент — выбор диаметра
import { DiameterPicker } from "@/components/DiameterPicker";

// Группа тестов выбора диаметра
describe("DiameterPicker", () => {
  // Готовые размеры и отметка выбранного
  it("пресеты 30–70 см, выбранный отмечен", () => {
    // Рисуем с выбранными 50 см
    render(<DiameterPicker value={50} onChange={() => {}} />);
    // Все кнопки-переключатели
    const radios = screen.getAllByRole("radio");
    // Подписи — пять готовых размеров
    expect(radios.map((r) => r.textContent)).toEqual(["30", "40", "50", "60", "70"]);
    // 50 отмечен как выбранный
    expect(screen.getByRole("radio", { name: "50" })).toHaveAttribute("aria-checked", "true");
  });

  // Клик по готовому размеру сообщает новое значение
  it("клик по пресету", () => {
    // Шпион
    const onChange = vi.fn();
    // Рисуем
    render(<DiameterPicker value={50} onChange={onChange} />);
    // Кликаем по 70
    fireEvent.click(screen.getByRole("radio", { name: "70" }));
    // Получили 70
    expect(onChange).toHaveBeenCalledWith(70);
  });

  // Таблица правильных своих значений: ввод → ожидаемое число
  it.each([
    // Целое
    ["45", 45],
    // С запятой
    ["45,5", 45.5],
    // С точкой, округляется до 0,1
    ["33.33", 33.3],
    // Нижняя граница
    ["20", 20],
    // Верхняя граница
    ["150", 150],
  // Имя теста подставляет ввод и ожидание
  ])("своё значение %s → %f", (raw, expected) => {
    // Шпион
    const onChange = vi.fn();
    // Рисуем
    render(<DiameterPicker value={50} onChange={onChange} />);
    // Вводим значение в поле
    fireEvent.change(screen.getByLabelText("Свой диаметр, см"), { target: { value: raw } });
    // Получили число
    expect(onChange).toHaveBeenCalledWith(expected);
  });

  // Неправильные значения: меньше 20, больше 150, не число, отрицательное
  it.each(["19.9", "151", "abc", "-5"])("невалидное %s показывает ошибку и не уходит наружу", (raw) => {
    // Шпион
    const onChange = vi.fn();
    // Рисуем
    render(<DiameterPicker value={50} onChange={onChange} />);
    // Вводим значение
    fireEvent.change(screen.getByLabelText("Свой диаметр, см"), { target: { value: raw } });
    // Наружу ничего не ушло
    expect(onChange).not.toHaveBeenCalled();
    // Видна подсказка с допустимым диапазоном
    expect(screen.getByRole("alert")).toHaveTextContent("Диаметр от 20 до 150 см");
  });
});
