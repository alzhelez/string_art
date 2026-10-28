// Перенос портрета файлом: адреса API и кнопка «Открыть файл .nitegraf» в списке портретов

// Отрисовка, события, поиск, ожидание
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
// Описание тестов, хуки, проверки, подмены
import { afterEach, describe, expect, it, vi } from "vitest";

// Шпион перехода между страницами
const push = vi.fn();
// Подменяем роутер Next.js: в jsdom его нет
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// Список портретов (после подмены роутера)
import { ProjectList } from "@/components/ProjectList";
// API-клиент
import { api } from "@/lib/api";

// Группа тестов
describe("перенос файлом .nitegraf", () => {
  // После каждого теста — настоящий fetch и чистые шпионы
  afterEach(() => {
    // Настоящий fetch
    vi.unstubAllGlobals();
    // Шпион перехода — с нуля
    push.mockReset();
  });

  // Адрес файла проекта
  it("exportUrl", () => {
    // Адрес
    expect(api.exportUrl("abcabcabcabc")).toBe("/api/projects/abcabcabcabc/export");
  });

  // Открытие файла: форма с полем file и имя файла
  it("importFile отправляет файл формой", async () => {
    // Шпион fetch
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "abcabcabcabc" }), { status: 201 }));
    // Ставим
    vi.stubGlobal("fetch", fetchMock);
    // Открываем
    await api.importFile(new Blob(["{}"]), "Мама.nitegraf");
    // Адрес и метод
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // Проверка адреса
    expect(url).toBe("/api/projects/import");
    // Метод POST
    expect(init.method).toBe("POST");
    // Файл в поле file с именем
    expect(((init.body as FormData).get("file") as File).name).toBe("Мама.nitegraf");
  });

  // Кнопка в списке: удачно — переход в студию, ошибка — понятный текст
  it("кнопка «Открыть файл»: переход в студию или текст ошибки", async () => {
    // Ответы fetch: список (пустой), затем импорт
    const fetchMock = vi
      // Шпион
      .fn()
      // Список портретов
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      // Первый файл — успех
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "abcabcabcabc" }), { status: 201 }))
      // Второй файл — испорчен
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Файл проекта испорчен: Номер гвоздя вне 0…239 (project.sequence)" }), { status: 422 }));
    // Ставим
    vi.stubGlobal("fetch", fetchMock);
    // Рисуем список
    render(<ProjectList />);
    // Дожидаемся пустого списка
    await screen.findByTestId("empty-projects");
    // Поле файла
    const input = screen.getByTestId("import-input") as HTMLInputElement;
    // Выбираем файл
    fireEvent.change(input, { target: { files: [new File(["{}"], "Мама.nitegraf")] } });
    // Переход в студию нового портрета
    await waitFor(() => expect(push).toHaveBeenCalledWith("/project?id=abcabcabcabc"));
    // Второй файл — испорченный
    fireEvent.change(input, { target: { files: [new File(["{}"], "плохой.nitegraf")] } });
    // Текст ошибки сервера виден
    expect(await screen.findByRole("alert")).toHaveTextContent("Файл проекта испорчен");
    // Перехода больше не было
    expect(push).toHaveBeenCalledTimes(1);
  });
});
