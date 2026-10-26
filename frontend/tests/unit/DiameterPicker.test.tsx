import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiameterPicker } from "@/components/DiameterPicker";

describe("DiameterPicker", () => {
  it("пресеты 30–70 см, выбранный отмечен", () => {
    render(<DiameterPicker value={50} onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["30", "40", "50", "60", "70"]);
    expect(screen.getByRole("radio", { name: "50" })).toHaveAttribute("aria-checked", "true");
  });

  it("клик по пресету", () => {
    const onChange = vi.fn();
    render(<DiameterPicker value={50} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "70" }));
    expect(onChange).toHaveBeenCalledWith(70);
  });

  it.each([
    ["45", 45],
    ["45,5", 45.5],
    ["33.33", 33.3],
    ["20", 20],
    ["150", 150],
  ])("своё значение %s → %f", (raw, expected) => {
    const onChange = vi.fn();
    render(<DiameterPicker value={50} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Свой диаметр, см"), { target: { value: raw } });
    expect(onChange).toHaveBeenCalledWith(expected);
  });

  it.each(["19.9", "151", "abc", "-5"])("невалидное %s показывает ошибку и не уходит наружу", (raw) => {
    const onChange = vi.fn();
    render(<DiameterPicker value={50} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Свой диаметр, см"), { target: { value: raw } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Диаметр от 20 до 150 см");
  });
});
