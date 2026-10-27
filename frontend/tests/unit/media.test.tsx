import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SimilarityChart } from "@/components/SimilarityChart";
import { WeavePlayer } from "@/components/WeavePlayer";
import { canSync, fileItem, iframeCommand, loadMusic, loadSavedLinks, parseEmbedCode, parseMediaInput, parseMediaLink, saveLinks } from "@/lib/media";
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

  it("показывает сходство ближайшей точки относительно лучшей", () => {
    render(<SimilarityChart data={data} lines={4800} />);
    expect(screen.getByTestId("similarity-current")).toHaveTextContent(/96,5\s% от лучшего/);
    expect(screen.getByRole("figure")).toHaveAccessibleName(/лучшее при 2200 линиях/);
    cleanup();
    render(<SimilarityChart data={data} lines={2200} />);
    expect(screen.getByTestId("similarity-current")).toHaveTextContent(/100,0\s% от лучшего/);
  });
});

const YANDEX_CODE = `<iframe frameborder="0" allow="clipboard-write" style="border:none;width:614px;height:556px;" width="614" height="556" src="https://music.yandex.ru/iframe/playlist/alzhelez2018/3">Слушайте <a href="https://music.yandex.ru/playlists/lk.31e5ca91-789f-4121-9c86-1dd29042fd0d?utm_source=web&utm_medium=copy_link">Мне нравится</a> — <a href="https://music.yandex.ru/users/alzhelez2018">Alzhelez21</a> на Яндекс Музыке</iframe>`;
const VK_CODE = `<iframe src="https://vkvideo.ru/video_ext.php?oid=-229696756&id=456255681&hash=41066a0b1e203f04&hd=4" width="1920" height="1080" allow="autoplay; encrypted-media; fullscreen; picture-in-picture; screen-wake-lock;" frameborder="0" allowfullscreen></iframe>`;

describe("коды встраивания: VK Видео, Яндекс Музыка, любой сайт", () => {
  it("Яндекс Музыка: адрес виджета, название из кода, высота", () => {
    const item = parseEmbedCode(YANDEX_CODE)!;
    expect(item).toMatchObject({
      kind: "yandex-music",
      video: false,
      src: "https://music.yandex.ru/iframe/playlist/alzhelez2018/3",
      title: "Мне нравится — Alzhelez21",
      height: 556,
    });
    expect(canSync(item)).toBe(false);
  });

  it("Яндекс Музыка по ссылке на альбом, трек и плейлист", () => {
    expect(parseMediaLink("https://music.yandex.ru/album/123/track/456?utm=x")!.src).toBe("https://music.yandex.ru/iframe/album/123/track/456");
    expect(parseMediaLink("https://music.yandex.com/album/123")!.src).toBe("https://music.yandex.ru/iframe/album/123");
    expect(parseMediaLink("https://music.yandex.ru/users/alzhelez2018/playlists/3")!.src).toBe(
      "https://music.yandex.ru/iframe/playlist/alzhelez2018/3",
    );
  });

  it("VK Видео: код «Экспортировать» с hash", () => {
    const item = parseEmbedCode(VK_CODE)!;
    expect(item.kind).toBe("vk");
    expect(item.video).toBe(true);
    const u = new URL(item.src);
    expect(u.origin + u.pathname).toBe("https://vkvideo.ru/video_ext.php");
    expect(Object.fromEntries(u.searchParams)).toEqual({ oid: "-229696756", id: "456255681", hash: "41066a0b1e203f04", hd: "4" });
  });

  it.each([
    "https://vkvideo.ru/video-229696756_456255681",
    "https://vk.com/video-229696756_456255681",
    "https://vk.com/video?z=video-229696756_456255681%2Fpl_cat_trends",
    "https://m.vk.com/clip-229696756_456255681",
  ])("VK Видео по ссылке: %s", (link) => {
    expect(parseMediaLink(link)).toMatchObject({
      kind: "vk",
      src: "https://vkvideo.ru/video_ext.php?oid=-229696756&id=456255681&hd=2",
    });
  });

  it("YouTube «Встроить» и незнакомый сайт", () => {
    expect(parseEmbedCode('<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ?si=x"></iframe>')!.kind).toBe("youtube");
    const other = parseEmbedCode('<iframe src="https://ok.ru/videoembed/123" width="640" height="360" title="Фильм"></iframe>')!;
    expect(other).toMatchObject({ kind: "embed", title: "Фильм", video: true, src: "https://ok.ru/videoembed/123" });
  });

  it("код без iframe, не https или со скриптом — не принимается", () => {
    expect(parseEmbedCode("<div>привет</div>")).toBeNull();
    expect(parseEmbedCode('<iframe src="http://example.com/x"></iframe>')).toBeNull();
    expect(parseEmbedCode('<iframe src="javascript:alert(1)"></iframe>')).toBeNull();
    expect(parseMediaInput("просто текст")).toBeNull();
    expect(parseMediaInput(VK_CODE)!.kind).toBe("vk");
    expect(parseMediaInput("https://youtu.be/dQw4w9WgXcQ")!.kind).toBe("youtube");
  });
});

const weave = () =>
  render(<WeavePlayer sequence={[0, 120, 30, 150, 0]} totalSteps={4} diameterCm={50} initialStep={1} initialSpeedSec={2} title="Бабушка" />);

describe("WeavePlayer: видео и музыка", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it("без видео на сцене — схема; добавили ссылку — видео на сцене, схема рядом", () => {
    weave();
    expect(screen.queryByTestId("media-screen")).not.toBeInTheDocument();
    expect(screen.getByTestId("board")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Ссылка или код <iframe …>"), { target: { value: "https://youtu.be/dQw4w9WgXcQ" } });
    fireEvent.click(within(screen.getByTestId("media-panel")).getByRole("button", { name: "Добавить" }));
    expect(within(screen.getByRole("list", { name: "Плейлист" })).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByTitle("YouTube: dQw4w9WgXcQ")).toHaveAttribute("src", expect.stringContaining("youtube-nocookie"));
    expect(screen.getByTestId("media-screen")).toBeInTheDocument();
    expect(screen.getByTestId("board")).toBeInTheDocument(); // схема переехала в правую колонку
    expect(screen.getByTestId("current-step")).toBeInTheDocument();
    expect(loadSavedLinks()).toHaveLength(1);
  });

  it("код VK Видео вставкой из буфера — добавляется сразу, без песочницы", () => {
    weave();
    fireEvent.paste(screen.getByLabelText("Ссылка или код <iframe …>"), { clipboardData: { getData: () => VK_CODE } });
    const frame = screen.getByTitle("VK Видео");
    expect(frame).toHaveAttribute("src", expect.stringContaining("hash=41066a0b1e203f04"));
    expect(frame).not.toHaveAttribute("sandbox");
    expect(screen.getByText(/не даёт управлять собой/)).toBeInTheDocument();
  });

  it("ошибка на неправильную ссылку и не-медиафайл", () => {
    weave();
    fireEvent.change(screen.getByLabelText("Ссылка или код <iframe …>"), { target: { value: "не ссылка" } });
    fireEvent.click(within(screen.getByTestId("media-panel")).getByRole("button", { name: "Добавить" }));
    expect(within(screen.getByTestId("media-panel")).getByRole("alert")).toHaveTextContent("Не похоже на ссылку");
    fireEvent.change(screen.getByTestId("media-file-input"), { target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });
    expect(within(screen.getByTestId("media-panel")).getByRole("alert")).toHaveTextContent("Это не аудио и не видео");
  });

  it("файл: плеер на сцене, удаление освобождает память", () => {
    weave();
    fireEvent.change(screen.getByTestId("media-file-input"), { target: { files: [new File(["x"], "Песня.mp3", { type: "audio/mpeg" })] } });
    expect(screen.getByTestId("media-element").tagName).toBe("AUDIO");
    fireEvent.click(screen.getByRole("button", { name: "Убрать «Песня»" }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
    expect(screen.queryByTestId("media-element")).not.toBeInTheDocument();
  });

  it("пауза и продолжение вместе с плетением", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    weave();
    fireEvent.change(screen.getByTestId("media-file-input"), { target: { files: [new File(["x"], "film.mp4", { type: "video/mp4" })] } });
    expect(screen.getByTestId("media-element").tagName).toBe("VIDEO");
    fireEvent.click(screen.getByRole("button", { name: "Старт" }));
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Пауза" }));
    expect(pause).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("switch", { name: /Пауза вместе с плетением/ }));
    fireEvent.click(screen.getByRole("button", { name: "Старт" }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("stringart.media.sync")).toBe("0");
  });

  it("музыка — отдельная графа: код Яндекс Музыки, название, запоминается", () => {
    weave();
    const dock = screen.getByTestId("music-dock");
    fireEvent.change(within(dock).getByLabelText("Код Яндекс Музыки или ссылка"), { target: { value: YANDEX_CODE } });
    fireEvent.click(within(dock).getByRole("button", { name: "Добавить" }));
    const frame = within(dock).getByTestId("music-frame");
    expect(frame).toHaveAttribute("src", "https://music.yandex.ru/iframe/playlist/alzhelez2018/3");
    expect(frame).toHaveStyle({ height: "180px" });
    expect(dock).toHaveTextContent("Мне нравится — Alzhelez21");
    fireEvent.click(within(dock).getByRole("button", { name: "Развернуть плеер" }));
    expect(frame).toHaveStyle({ height: "556px" });
    expect(loadMusic()).toHaveLength(1);
    // видео не тронуто: музыка играет отдельно
    expect(screen.queryByTestId("media-screen")).not.toBeInTheDocument();
  });

  it("кино: на весь экран с шагом поверх; Esc — выход", async () => {
    weave();
    fireEvent.change(screen.getByLabelText("Ссылка или код <iframe …>"), { target: { value: VK_CODE } });
    fireEvent.click(within(screen.getByTestId("media-panel")).getByRole("button", { name: "Добавить" }));
    // в jsdom нет Fullscreen API — включается запасной режим «на всё окно»
    fireEvent.click(screen.getByTestId("cinema-toggle"));
    expect(await screen.findByTestId("cinema-hud")).toHaveTextContent("A1 → C1");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("cinema-hud")).not.toBeInTheDocument();
  });
});

describe("WeavePlayer: сигнал шага", () => {
  it("переключает режим и запоминает его", () => {
    render(<WeavePlayer sequence={[0, 120, 30]} totalSteps={2} diameterCm={50} initialStep={1} initialSpeedSec={2} />);
    fireEvent.click(screen.getByRole("tab", { name: /Сигнал шага/ }));
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
