// Добавляет в expect проверки для DOM: toBeInTheDocument, toHaveTextContent и т. п.
import "@testing-library/jest-dom/vitest";
// cleanup убирает отрисованные компоненты из документа
import { cleanup } from "@testing-library/react";
// Хук «после каждого теста» и инструменты подмены
import { afterEach, vi } from "vitest";

// После каждого теста очищаем DOM, чтобы тесты не влияли друг на друга
afterEach(() => cleanup());

// jsdom не умеет canvas — отдаём «пустой» контекст, чтобы Board рендерился без ошибок
// (в тестах без DOM — «@vitest-environment node» — холста нет вовсе, подменять нечего).
if (typeof HTMLCanvasElement !== "undefined") {
  // Пустой контекст
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}
