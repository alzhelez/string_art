// @vitest-environment node
// Распознавание речи вне браузера (сборка страниц на сервере): нет window — нет распознавания

// Описание теста и проверки
import { expect, it } from "vitest";
// Поиск распознавания речи
import { recognitionCtor } from "@/lib/control";

// Без window — null, а не ошибка
it("recognitionCtor без window — null", () => {
  // Окна нет
  expect(typeof window).toBe("undefined");
  // Распознавания нет
  expect(recognitionCtor()).toBeNull();
});
