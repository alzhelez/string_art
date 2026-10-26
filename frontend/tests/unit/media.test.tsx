import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaPanel } from "@/components/MediaPanel";
import { SimilarityChart } from "@/components/SimilarityChart";
import { WeavePlayer } from "@/components/WeavePlayer";
import { fileItem, iframeCommand, loadSavedLinks, parseMediaLink, saveLinks } from "@/lib/media";
import { chime, DEFAULT_SOUND, readSoundPrefs, saveSoundPrefs } from "@/lib/sound";

beforeEach(() => localStorage.clear());

describe("parseMediaLink", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=42", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123", "dQw4w9WgXcQ"],
    ["https://youtube.com/shorts/abcDEF12345", "abcDEF12345"],
    ["https://www.youtube.com/embed/abcDEF12345", "abcDEF12345"],
    ["https://music.youtube.com/watch?v=abcDEF12345", "abcDEF12345"],
  ])("YouTube: %s", (link, id) => {
    const item = parseMediaLink(link)!;
    expect(item.kind).toBe("youtube");
    expect(item.video).toBe(true);
    expect(item.src).toMatch(new RegExp(`^https://www\\.youtube-nocookie\\.com/embed/${id}\\?`));
    expect(item.src).toContain("enablejsapi=1");
  });

  it("YouTube: плейлист сохраняется", () => {
    expect(parseMediaLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123")!.src).toContain("list=PL123");
  });

  it("RuTube превращается во встраиваемый плеер", () => {
    const item = parseMediaLink("https://rutube.ru/video/0123456789abcdef0123456789abcdef/")!;
    expect(item.kind).toBe("rutube");
    expect(item.src).toBe("https://rutube.ru/play/embed/0123456789abcdef0123456789abcdef");
  });

  it("прямая ссылка на mp3 — аудио, на mp4 — видео", () => {
    const mp3 = parseMediaLink("https://example.com/music/%D0%BF%D0%B5%D1%81%D0%BD%D1%8F.mp3")!;
    expect(mp3).toMatchObject({ kind: "url", video: false, title: "песня.mp3" });
    expect(parseMediaLink("https://example.com/film.mp4?x=1")!.video).toBe(true);
  });

  it("поток радио без расширения играется как аудио", () => {
    expect(parseMediaLink("https://stream.example.com/live")).toMatchObject({ kind: "url", video: false });
  });

  it.each(["", "просто текст", "ftp://example.com/a.mp3", "javascript:alert(1)"])("не ссылка: %j", (s) => {
    expect(parseMediaLink(s)).toBeNull();
  });
});

describe("iframeCommand / fileItem / сохранение ссылок", () => {
  it("команды YouTube и RuTube", () => {
    const yt = parseMediaLink("https://youtu.be/dQw4w9WgXcQ")!;
    const rt = parseMediaLink("https://rutube.ru/video/0123456789abcdef0123456789abcdef/")!;
    expect(JSON.parse(iframeCommand(yt, "pause")!)).toEqual({ event: "command", func: "pauseVideo", args: "" });
    expect(JSON.parse(iframeCommand(yt, "volume", 0.3)!).args).toEqual([30]);
    expect(JSON.parse(iframeCommand(rt, "play")!).type).toBe("player:play");
    expect(iframeCommand(parseMediaLink("https://e.com/a.mp3")!, "play")).toBeNull();
  });

  it("fileItem: название без расширения, тип по MIME", () => {
    const item = fileItem(new File(["x"], "Мой фильм.mkv", { type: "" }), () => "blob:1");
    expect(item).toMatchObject({ kind: "file", title: "Мой фильм", src: "blob:1", video: true });
    expect(fileItem(new File(["x"], "a.mp3", { type: "audio/mpeg" }), () => "blob:2").video).toBe(false);
  });

  it("ссылки сохраняются, файлы — нет; битые данные не ломают", () => {
    saveLinks([parseMediaLink("https://youtu.be/dQw4w9WgXcQ")!, fileItem(new File(["x"], "a.mp3"), () => "blob:3")]);
    expect(loadSavedLinks().map((i) => i.kind)).toEqual(["youtube"]);
    localStorage.setItem("stringart.media.links", "{не json");
    expect(loadSavedLinks()).toEqual([]);
  });
});

describe("настройки звука", () => {
  it("по умолчанию — сигнал", () => {
    expect(readSoundPrefs()).toEqual(DEFAULT_SOUND);
  });

  it("сохраняются и читаются, громкость ограничена", () => {
    saveSoundPrefs({ kind: "voice", voiceMode: "full", volume: 0.8 });
    expect(readSoundPrefs()).toEqual({ kind: "voice", voiceMode: "full", volume: 0.8 });
    localStorage.setItem("stringart.sound", JSON.stringify({ kind: "???", volume: 7 }));
    expect(readSoundPrefs()).toEqual({ kind: "chime", voiceMode: "target", volume: 1 });
  });

  it("переносит настройку голоса из первой версии", () => {
    localStorage.setItem("stringart.voice", JSON.stringify({ enabled: true, mode: "full" }));
    expect(readSoundPrefs()).toMatchObject({ kind: "voice", voiceMode: "full" });
  });

  it("chime ничего не делает без WebAudio и при нулевой громкости", () => {
    expect(() => chime(0.5)).not.toThrow();
    expect(() => chime(0)).not.toThrow();
  });

  it("chime играет два тона через WebAudio", () => {
    const osc = { type: "", frequency: { value: 0 }, connect: vi.fn((g) => g), start: vi.fn(), stop: vi.fn() };
    const gain = {
      gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    };
    const created: number[] = [];
    class FakeAC {
      state = "running";
      currentTime = 0;
      destination = {};
      createOscillator() {
        created.push(1);
        return { ...osc, frequency: { value: 0 } };
      }
      createGain() {
        return gain;
      }
      resume() {}
    }
    vi.stubGlobal("AudioContext", FakeAC);
    chime(0.5);
    expect(created).toHaveLength(2);
    vi.unstubAllGlobals();
  });
});

describe("SimilarityChart", () => {
  const data = {
    diameter_cm: 50,
    best_lines: 2200,
    best_score: 0.912,
    curve: [
      { lines: 1000, score: 0.85 },
      { lines: 2200, score: 0.912 },
      { lines: 5000, score: 0.88 },
    ],
  };

  it("показывает сходство ближайшей точки и максимум", () => {
    render(<SimilarityChart data={data} lines={4800} />);
    expect(screen.getByTestId("similarity-current")).toHaveTextContent(/88,0\s%/);
    expect(screen.getByRole("figure")).toHaveAccessibleName(/максимум 91,2\s% при 2200 линиях/);
  });
});

describe("MediaPanel", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it("добавляет ссылку YouTube в плейлист и встраивает плеер", () => {
    render(<MediaPanel weavePlaying={false} />);
    fireEvent.change(screen.getByLabelText("Ссылка на видео, музыку или радио"), {
      target: { value: "https://youtu.be/dQw4w9WgXcQ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    expect(within(screen.getByRole("list", { name: "Плейлист" })).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByTitle("YouTube: dQw4w9WgXcQ")).toHaveAttribute("src", expect.stringContaining("youtube-nocookie"));
    expect(loadSavedLinks()).toHaveLength(1);
  });

  it("ошибка на неправильную ссылку", () => {
    render(<MediaPanel weavePlaying={false} />);
    fireEvent.change(screen.getByLabelText("Ссылка на видео, музыку или радио"), { target: { value: "не ссылка" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Не похоже на ссылку");
  });

  it("файл с компьютера: аудио-плеер, удаление, отказ для не-медиа", () => {
    render(<MediaPanel weavePlaying={false} />);
    const input = screen.getByTestId("media-file-input");
    fireEvent.change(input, { target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });
    expect(screen.getByRole("alert")).toHaveTextContent("Это не аудио и не видео");
    fireEvent.change(input, { target: { files: [new File(["x"], "Песня.mp3", { type: "audio/mpeg" })] } });
    expect(screen.getByTestId("media-element").tagName).toBe("AUDIO");
    expect(screen.getByText("Песня", { selector: "strong" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Убрать «Песня»" }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
    expect(screen.queryByTestId("media-element")).not.toBeInTheDocument();
  });

  it("пауза и продолжение вместе с плетением", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const { rerender } = render(<MediaPanel weavePlaying={false} />);
    fireEvent.change(screen.getByTestId("media-file-input"), {
      target: { files: [new File(["x"], "film.mp4", { type: "video/mp4" })] },
    });
    rerender(<MediaPanel weavePlaying={true} />);
    expect(play).toHaveBeenCalledTimes(1);
    rerender(<MediaPanel weavePlaying={false} />);
    expect(pause).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("switch", { name: /Пауза вместе с плетением/ }));
    rerender(<MediaPanel weavePlaying={true} />);
    expect(play).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("stringart.media.sync")).toBe("0");
  });
});

describe("WeavePlayer: сигнал шага", () => {
  it("переключает режим и запоминает его", () => {
    render(<WeavePlayer sequence={[0, 120, 30]} totalSteps={2} diameterCm={50} initialStep={1} initialSpeedSec={2} />);
    const group = screen.getByRole("radiogroup", { name: "Сигнал шага" });
    expect(within(group).getByRole("radio", { name: /Сигнал/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Громкость сигнала")).toBeInTheDocument();
    fireEvent.click(within(group).getByRole("radio", { name: /Без звука/ }));
    expect(readSoundPrefs().kind).toBe("none");
    expect(screen.queryByLabelText("Громкость сигнала")).not.toBeInTheDocument();
    // В jsdom нет speechSynthesis — голос недоступен
    expect(within(group).getByRole("radio", { name: /Голос/ })).toBeDisabled();
  });
});
