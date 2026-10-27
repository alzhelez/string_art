import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "@/lib/api";
import { lineAlpha } from "@/lib/draw";
import { num, seconds } from "@/lib/format";
import { scaledSize } from "@/lib/image";
import { speak, spokenNail, spokenStep } from "@/lib/speech";
import { canGoFaster, canGoSlower, clampSpeed, faster, slower } from "@/lib/speed";

describe("скорость автоперелистывания", () => {
  it("по умолчанию шаг 0,1 с без ошибок округления", () => {
    let s = 2.0;
    for (let i = 0; i < 3; i++) s = faster(s);
    expect(s).toBe(1.7);
    for (let i = 0; i < 5; i++) s = slower(s);
    expect(s).toBe(2.2);
  });

  it("не выходит за 0,5…10 с", () => {
    expect(faster(0.5)).toBe(0.5);
    expect(slower(10)).toBe(10);
    expect(clampSpeed(0.1)).toBe(0.5);
    expect(clampSpeed(42)).toBe(10);
    expect(canGoFaster(0.5)).toBe(false);
    expect(canGoSlower(10)).toBe(false);
    expect(canGoFaster(0.6)).toBe(true);
  });
});

describe("озвучка", () => {
  it("буквы секторов читаются по-русски", () => {
    expect(spokenNail(0)).toBe("А 1");
    expect(spokenNail(64)).toBe("Бэ 5");
    expect(spokenNail(156)).toBe("Цэ 37");
    expect(spokenNail(239)).toBe("Дэ 60");
  });

  it("режимы «куда» и «откуда и куда»", () => {
    expect(spokenStep(11, 156, "target")).toBe("Цэ 37");
    expect(spokenStep(11, 156, "full")).toBe("А 12, Цэ 37");
  });

  it("speak() обрывает предыдущую фразу и говорит по-русски", () => {
    const spoken: SpeechSynthesisUtterance[] = [];
    const cancel = vi.fn();
    vi.stubGlobal("SpeechSynthesisUtterance", class {
      lang = "";
      rate = 1;
      voice: unknown = null;
      constructor(public text: string) {}
    });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: { cancel, speak: (u: SpeechSynthesisUtterance) => spoken.push(u), getVoices: () => [] },
    });
    speak("Цэ 37");
    expect(cancel).toHaveBeenCalledOnce();
    expect(spoken[0].text).toBe("Цэ 37");
    expect(spoken[0].lang).toBe("ru-RU");
    vi.unstubAllGlobals();
  });
});

describe("форматирование", () => {
  it("русские разделители", () => {
    expect(num(1176.7, 1)).toBe("1 176,7");
    expect(seconds(2)).toBe("2,0 с");
  });
});

describe("превью", () => {
  it("на маленьком круге одна линия темнее", () => {
    expect(lineAlpha(800, 30)).toBeGreaterThan(lineAlpha(800, 70));
    expect(lineAlpha(800, 50)).toBeCloseTo(0.32, 5); // 0,2 мм / (500 мм / 800 px)
  });

  it("уменьшение фото сохраняет пропорции", () => {
    expect(scaledSize(4000, 3000)).toEqual([1600, 1200]);
    expect(scaledSize(800, 600)).toEqual([800, 600]);
  });
});

describe("api-клиент", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("достаёт текст ошибки из detail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Проект не найден" }), { status: 404 })));
    await expect(api.get("000000000000")).rejects.toMatchObject({ status: 404, message: "Проект не найден" });
  });

  it("сетевую ошибку объясняет понятным текстом", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const err = await api.list().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/бэкенд/);
  });

  it("PATCH отправляет JSON", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await api.update("abcabcabcabc", { current_step: 5 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/projects/abcabcabcabc");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ current_step: 5 });
  });
});

describe("routes", () => {
  it("адреса страниц проекта — с ?id=, чтобы работала статическая сборка", async () => {
    const { routes } = await import("@/lib/routes");
    expect(routes.project("abc123def456")).toBe("/project?id=abc123def456");
    expect(routes.weave("abc123def456")).toBe("/project/weave?id=abc123def456");
    expect(routes.photo("a b")).toBe("/project/photo?id=a%20b");
  });
});
