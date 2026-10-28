// Отрисовка, очистка, поиск, события; within ищет внутри конкретного блока
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
// Описание тестов, хуки, проверки, подмены
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// График сходства с фото
import { SimilarityChart } from "@/components/SimilarityChart";
// Проигрыватель шагов — у него есть панель видео и музыки
import { WeavePlayer } from "@/components/WeavePlayer";
// Разбор ссылок и кодов встраивания, команды плеерам, сохранение списка
import { canSync, fileItem, iframeCommand, loadMusic, loadSavedLinks, parseEmbedCode, parseMediaInput, parseMediaLink, saveLinks } from "@/lib/media";
// Звуковой сигнал шага и его настройки
import { chime, DEFAULT_SOUND, readSoundPrefs, saveSoundPrefs } from "@/lib/sound";

// Перед каждым тестом очищаем localStorage — настройки не переходят из теста в тест
beforeEach(() => localStorage.clear());

// Группа: разбор ссылок
describe("parseMediaLink", () => {
  // Таблица ссылок YouTube и ожидаемых id ролика
  it.each([
    // Обычная ссылка
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    // Короткая со временем
    ["https://youtu.be/dQw4w9WgXcQ?t=42", "dQw4w9WgXcQ"],
    // Мобильная с плейлистом
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123", "dQw4w9WgXcQ"],
    // Shorts
    ["https://youtube.com/shorts/abcDEF12345", "abcDEF12345"],
    // Уже встраиваемая
    ["https://www.youtube.com/embed/abcDEF12345", "abcDEF12345"],
    // YouTube Music
    ["https://music.youtube.com/watch?v=abcDEF12345", "abcDEF12345"],
  // Имя теста
  ])("YouTube: %s", (link, id) => {
    // Разбираем ссылку
    const item = parseMediaLink(link)!;
    // Тип — YouTube
    expect(item.kind).toBe("youtube");
    // Это видео
    expect(item.video).toBe(true);
    // Встраивается через youtube-nocookie — без лишних cookie
    expect(item.src).toMatch(new RegExp(`^https://www\\.youtube-nocookie\\.com/embed/${id}\\?`));
    // С включённым управлением из страницы
    expect(item.src).toContain("enablejsapi=1");
  });

  // Плейлист не теряется
  it("YouTube: плейлист сохраняется", () => {
    // Параметр list остался в адресе
    expect(parseMediaLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123")!.src).toContain("list=PL123");
  });

  // RuTube
  it("RuTube превращается во встраиваемый плеер", () => {
    // Разбираем ссылку на ролик
    const item = parseMediaLink("https://rutube.ru/video/0123456789abcdef0123456789abcdef/")!;
    // Тип — RuTube
    expect(item.kind).toBe("rutube");
    // Адрес встраиваемого плеера
    expect(item.src).toBe("https://rutube.ru/play/embed/0123456789abcdef0123456789abcdef");
  });

  // Прямые ссылки на файлы
  it("прямая ссылка на mp3 — аудио, на mp4 — видео", () => {
    // mp3 с русским именем в процент-кодировке
    const mp3 = parseMediaLink("https://example.com/music/%D0%BF%D0%B5%D1%81%D0%BD%D1%8F.mp3")!;
    // Аудио, имя раскодировано
    expect(mp3).toMatchObject({ kind: "url", video: false, title: "песня.mp3" });
    // mp4 — видео
    expect(parseMediaLink("https://example.com/film.mp4?x=1")!.video).toBe(true);
  });

  // Ссылка без расширения — радиопоток
  it("поток радио без расширения играется как аудио", () => {
    // Считается аудио
    expect(parseMediaLink("https://stream.example.com/live")).toMatchObject({ kind: "url", video: false });
  });

  // Не ссылки: пусто, текст, ftp, javascript
  it.each(["", "просто текст", "ftp://example.com/a.mp3", "javascript:alert(1)"])("не ссылка: %j", (s) => {
    // Ничего не возвращается
    expect(parseMediaLink(s)).toBeNull();
  });
});

// Группа: команды плеерам, файлы и сохранение
describe("iframeCommand / fileItem / сохранение ссылок", () => {
  // Команды встроенным плеерам
  it("команды YouTube и RuTube", () => {
    // Ролик YouTube
    const yt = parseMediaLink("https://youtu.be/dQw4w9WgXcQ")!;
    // Ролик RuTube
    const rt = parseMediaLink("https://rutube.ru/video/0123456789abcdef0123456789abcdef/")!;
    // Пауза YouTube — формат сообщения YouTube API
    expect(JSON.parse(iframeCommand(yt, "pause")!)).toEqual({ event: "command", func: "pauseVideo", args: "" });
    // Громкость 0,3 → 30 в формате YouTube
    expect(JSON.parse(iframeCommand(yt, "volume", 0.3)!).args).toEqual([30]);
    // Старт RuTube — его формат
    expect(JSON.parse(iframeCommand(rt, "play")!).type).toBe("player:play");
    // Для прямой ссылки команд нет — она играет в теге audio
    expect(iframeCommand(parseMediaLink("https://e.com/a.mp3")!, "play")).toBeNull();
  });

  // Файл с компьютера
  it("fileItem: название без расширения, тип по MIME", () => {
    // Видео без MIME, но с расширением .mkv
    const item = fileItem(new File(["x"], "Мой фильм.mkv", { type: "" }), () => "blob:1");
    // Название без расширения, видео
    expect(item).toMatchObject({ kind: "file", title: "Мой фильм", src: "blob:1", video: true });
    // mp3 с MIME — аудио
    expect(fileItem(new File(["x"], "a.mp3", { type: "audio/mpeg" }), () => "blob:2").video).toBe(false);
  });

  // Сохранение списка
  it("ссылки сохраняются, файлы — нет; битые данные не ломают", () => {
    // Сохраняем ссылку и файл
    saveLinks([parseMediaLink("https://youtu.be/dQw4w9WgXcQ")!, fileItem(new File(["x"], "a.mp3"), () => "blob:3")]);
    // Сохранилась только ссылка — файл после перезагрузки не открыть
    expect(loadSavedLinks().map((i) => i.kind)).toEqual(["youtube"]);
    // Портим сохранённые данные
    localStorage.setItem("stringart.media.links", "{не json");
    // Чтение не падает, а отдаёт пустой список
    expect(loadSavedLinks()).toEqual([]);
  });
});

// Группа: настройки звука
describe("настройки звука", () => {
  // По умолчанию
  it("по умолчанию — сигнал", () => {
    // Значение по умолчанию — короткий сигнал
    expect(readSoundPrefs()).toEqual(DEFAULT_SOUND);
  });

  // Сохранение и чтение
  it("сохраняются и читаются, громкость ограничена", () => {
    // Сохраняем голос, полный режим, громкость 0,8
    saveSoundPrefs({ kind: "voice", voiceMode: "full", volume: 0.8 });
    // Читаем то же самое
    expect(readSoundPrefs()).toEqual({ kind: "voice", voiceMode: "full", volume: 0.8 });
    // Портим: неизвестный вид, громкость 7
    localStorage.setItem("stringart.sound", JSON.stringify({ kind: "???", volume: 7 }));
    // Неизвестный вид → сигнал, громкость → 1
    expect(readSoundPrefs()).toEqual({ kind: "chime", voiceMode: "target", volume: 1 });
  });

  // Перенос настроек из первой версии
  it("переносит настройку голоса из первой версии", () => {
    // Старый ключ с голосом
    localStorage.setItem("stringart.voice", JSON.stringify({ enabled: true, mode: "full" }));
    // Перенесён в новый формат
    expect(readSoundPrefs()).toMatchObject({ kind: "voice", voiceMode: "full" });
  });

  // Без WebAudio сигнал просто молчит
  it("chime ничего не делает без WebAudio и при нулевой громкости", () => {
    // Обычная громкость — без ошибки
    expect(() => chime(0.5)).not.toThrow();
    // Нулевая — тоже
    expect(() => chime(0)).not.toThrow();
  });

  // С WebAudio звучат два тона
  it("chime играет два тона через WebAudio", () => {
    // Подделка генератора тона
    const osc = { type: "", frequency: { value: 0 }, connect: vi.fn((g) => g), start: vi.fn(), stop: vi.fn() };
    // Подделка регулятора громкости
    const gain = {
      // громкость с плавными изменениями
      gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      // подключение
      connect: vi.fn(),
    };
    // Сюда считаем созданные генераторы
    const created: number[] = [];
    // Подделка AudioContext
    class FakeAC {
      // Контекст работает
      state = "running";
      // Время 0
      currentTime = 0;
      // Выход
      destination = {};
      // Создание генератора —
      createOscillator() {
        // — считаем
        created.push(1);
        // — отдаём копию подделки
        return { ...osc, frequency: { value: 0 } };
      }
      // Создание регулятора
      createGain() {
        // Отдаём подделку
        return gain;
      }
      // Возобновление — ничего не делает
      resume() {}
    }
    // Ставим подделку вместо AudioContext
    vi.stubGlobal("AudioContext", FakeAC);
    // Играем сигнал
    chime(0.5);
    // Два тона
    expect(created).toHaveLength(2);
    // Возвращаем настоящий AudioContext
    vi.unstubAllGlobals();
  });
});

// Группа: график сходства
describe("SimilarityChart", () => {
  // Данные графика:
  const data = {
    // диаметр
    diameter_cm: 50,
    // лучшее число нитей
    best_lines: 2200,
    // лучшее сходство
    best_score: 0.912,
    // точки кривой
    curve: [
      // начало
      { lines: 1000, score: 0.85 },
      // максимум
      { lines: 2200, score: 0.912 },
      // конец
      { lines: 5000, score: 0.88 },
    ],
  };

  // Подпись сходства для текущего числа нитей
  it("показывает сходство ближайшей точки относительно лучшей", () => {
    // Рисуем для 4800 нитей
    render(<SimilarityChart data={data} lines={4800} />);
    // Ближайшая точка 5000: 0,88 / 0,912 = 96,5 %
    expect(screen.getByTestId("similarity-current")).toHaveTextContent(/96,5\s% от лучшего/);
    // Описание графика для читалок экрана
    expect(screen.getByRole("figure")).toHaveAccessibleName(/лучшее при 2200 линиях/);
    // Убираем первый график
    cleanup();
    // Рисуем для лучшего числа нитей
    render(<SimilarityChart data={data} lines={2200} />);
    // 100 %
    expect(screen.getByTestId("similarity-current")).toHaveTextContent(/100,0\s% от лучшего/);
  });
});

// Настоящий код встраивания Яндекс Музыки (кнопка «Поделиться → HTML-код»)
const YANDEX_CODE = `<iframe frameborder="0" allow="clipboard-write" style="border:none;width:614px;height:556px;" width="614" height="556" src="https://music.yandex.ru/iframe/playlist/alzhelez2018/3">Слушайте <a href="https://music.yandex.ru/playlists/lk.31e5ca91-789f-4121-9c86-1dd29042fd0d?utm_source=web&utm_medium=copy_link">Мне нравится</a> — <a href="https://music.yandex.ru/users/alzhelez2018">Alzhelez21</a> на Яндекс Музыке</iframe>`;
// Настоящий код VK Видео (кнопка «Экспортировать»)
const VK_CODE = `<iframe src="https://vkvideo.ru/video_ext.php?oid=-229696756&id=456255681&hash=41066a0b1e203f04&hd=4" width="1920" height="1080" allow="autoplay; encrypted-media; fullscreen; picture-in-picture; screen-wake-lock;" frameborder="0" allowfullscreen></iframe>`;

// Группа: коды встраивания
describe("коды встраивания: VK Видео, Яндекс Музыка, любой сайт", () => {
  // Код Яндекс Музыки
  it("Яндекс Музыка: адрес виджета, название из кода, высота", () => {
    // Разбираем
    const item = parseEmbedCode(YANDEX_CODE)!;
    // Получаем:
    expect(item).toMatchObject({
      // тип
      kind: "yandex-music",
      // не видео
      video: false,
      // адрес виджета
      src: "https://music.yandex.ru/iframe/playlist/alzhelez2018/3",
      // название из текста ссылок
      title: "Мне нравится — Alzhelez21",
      // высоту из кода
      height: 556,
    });
    // Управлять плеером Яндекса со страницы нельзя
    expect(canSync(item)).toBe(false);
  });

  // Ссылки на Яндекс Музыку
  it("Яндекс Музыка по ссылке на альбом, трек и плейлист", () => {
    // Альбом с треком; лишние параметры отброшены
    expect(parseMediaLink("https://music.yandex.ru/album/123/track/456?utm=x")!.src).toBe("https://music.yandex.ru/iframe/album/123/track/456");
    // Домен .com тоже понимается
    expect(parseMediaLink("https://music.yandex.com/album/123")!.src).toBe("https://music.yandex.ru/iframe/album/123");
    // Плейлист пользователя
    expect(parseMediaLink("https://music.yandex.ru/users/alzhelez2018/playlists/3")!.src).toBe(
      // → виджет плейлиста
      "https://music.yandex.ru/iframe/playlist/alzhelez2018/3",
    );
  });

  // Код VK Видео
  it("VK Видео: код «Экспортировать» с hash", () => {
    // Разбираем
    const item = parseEmbedCode(VK_CODE)!;
    // Тип VK
    expect(item.kind).toBe("vk");
    // Видео
    expect(item.video).toBe(true);
    // Адрес как URL
    const u = new URL(item.src);
    // Правильный плеер
    expect(u.origin + u.pathname).toBe("https://vkvideo.ru/video_ext.php");
    // Все параметры, включая hash, сохранены
    expect(Object.fromEntries(u.searchParams)).toEqual({ oid: "-229696756", id: "456255681", hash: "41066a0b1e203f04", hd: "4" });
  });

  // Таблица ссылок VK
  it.each([
    // vkvideo.ru
    "https://vkvideo.ru/video-229696756_456255681",
    // vk.com
    "https://vk.com/video-229696756_456255681",
    // Ролик, открытый поверх раздела
    "https://vk.com/video?z=video-229696756_456255681%2Fpl_cat_trends",
    // Клип с мобильной версии
    "https://m.vk.com/clip-229696756_456255681",
  // Имя теста
  ])("VK Видео по ссылке: %s", (link) => {
    // Получаем:
    expect(parseMediaLink(link)).toMatchObject({
      // тип VK
      kind: "vk",
      // адрес плеера с id ролика
      src: "https://vkvideo.ru/video_ext.php?oid=-229696756&id=456255681&hd=2",
    });
  });

  // Код YouTube и незнакомого сайта
  it("YouTube «Встроить» и незнакомый сайт", () => {
    // Код «Встроить» YouTube понимается как YouTube
    expect(parseEmbedCode('<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ?si=x"></iframe>')!.kind).toBe("youtube");
    // Код другого сайта
    const other = parseEmbedCode('<iframe src="https://ok.ru/videoembed/123" width="640" height="360" title="Фильм"></iframe>')!;
    // Тип «встраивание», название из title
    expect(other).toMatchObject({ kind: "embed", title: "Фильм", video: true, src: "https://ok.ru/videoembed/123" });
  });

  // Опасные и неподходящие коды
  it("код без iframe, не https или со скриптом — не принимается", () => {
    // Нет iframe
    expect(parseEmbedCode("<div>привет</div>")).toBeNull();
    // Не https
    expect(parseEmbedCode('<iframe src="http://example.com/x"></iframe>')).toBeNull();
    // javascript вместо адреса
    expect(parseEmbedCode('<iframe src="javascript:alert(1)"></iframe>')).toBeNull();
    // Простой текст
    expect(parseMediaInput("просто текст")).toBeNull();
    // Код VK через общий разбор
    expect(parseMediaInput(VK_CODE)!.kind).toBe("vk");
    // Ссылка через общий разбор
    expect(parseMediaInput("https://youtu.be/dQw4w9WgXcQ")!.kind).toBe("youtube");
  });
});

// Помощник: проигрыватель с короткой схемой
const weave = () =>
  // Рисуем
  render(<WeavePlayer sequence={[0, 120, 30, 150, 0]} totalSteps={4} diameterCm={50} initialStep={1} initialSpeedSec={2} title="Бабушка" />);

// Группа: видео и музыка в проигрывателе
describe("WeavePlayer: видео и музыка", () => {
  // Перед каждым тестом —
  beforeEach(() => {
    // — подменяем создание адреса для файла (в jsdom его нет)
    URL.createObjectURL = vi.fn(() => "blob:test");
    // — и освобождение
    URL.revokeObjectURL = vi.fn();
  });
  // После — возвращаем всё как было
  afterEach(() => vi.restoreAllMocks());

  // Видео появляется на сцене, а схема остаётся рядом
  it("без видео на сцене — схема; добавили ссылку — видео на сцене, схема рядом", () => {
    // Рисуем
    weave();
    // Видео пока нет
    expect(screen.queryByTestId("media-screen")).not.toBeInTheDocument();
    // Схема на месте
    expect(screen.getByTestId("board")).toBeInTheDocument();
    // Вставляем ссылку YouTube
    fireEvent.change(screen.getByLabelText("Ссылка или код <iframe …>"), { target: { value: "https://youtu.be/dQw4w9WgXcQ" } });
    // «Добавить»
    fireEvent.click(within(screen.getByTestId("media-panel")).getByRole("button", { name: "Добавить" }));
    // В плейлисте одна запись
    expect(within(screen.getByRole("list", { name: "Плейлист" })).getAllByRole("listitem")).toHaveLength(1);
    // Плеер YouTube без cookie
    expect(screen.getByTitle("YouTube: dQw4w9WgXcQ")).toHaveAttribute("src", expect.stringContaining("youtube-nocookie"));
    // Видео на сцене
    expect(screen.getByTestId("media-screen")).toBeInTheDocument();
    // Схема по-прежнему видна
    expect(screen.getByTestId("board")).toBeInTheDocument(); // схема переехала в правую колонку
    // И текущий шаг тоже
    expect(screen.getByTestId("current-step")).toBeInTheDocument();
    // Ссылка сохранилась
    expect(loadSavedLinks()).toHaveLength(1);
  });

  // Вставка кода VK
  it("код VK Видео вставкой из буфера — добавляется сразу, без песочницы", () => {
    // Рисуем
    weave();
    // Вставляем код из буфера обмена
    fireEvent.paste(screen.getByLabelText("Ссылка или код <iframe …>"), { clipboardData: { getData: () => VK_CODE } });
    // Плеер VK
    const frame = screen.getByTitle("VK Видео");
    // С hash в адресе
    expect(frame).toHaveAttribute("src", expect.stringContaining("hash=41066a0b1e203f04"));
    // Без песочницы — иначе VK не играет
    expect(frame).not.toHaveAttribute("sandbox");
    // Подсказка, что паузу VK нужно ставить вручную
    expect(screen.getByText(/не даёт управлять собой/)).toBeInTheDocument();
  });

  // Ошибки ввода
  it("ошибка на неправильную ссылку и не-медиафайл", () => {
    // Рисуем
    weave();
    // Вводим не ссылку
    fireEvent.change(screen.getByLabelText("Ссылка или код <iframe …>"), { target: { value: "не ссылка" } });
    // «Добавить»
    fireEvent.click(within(screen.getByTestId("media-panel")).getByRole("button", { name: "Добавить" }));
    // Подсказка об ошибке
    expect(within(screen.getByTestId("media-panel")).getByRole("alert")).toHaveTextContent("Не похоже на ссылку");
    // Выбираем текстовый файл
    fireEvent.change(screen.getByTestId("media-file-input"), { target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });
    // Подсказка «не аудио и не видео»
    expect(within(screen.getByTestId("media-panel")).getByRole("alert")).toHaveTextContent("Это не аудио и не видео");
  });

  // Файл с компьютера
  it("файл: плеер на сцене, удаление освобождает память", () => {
    // Рисуем
    weave();
    // Выбираем mp3
    fireEvent.change(screen.getByTestId("media-file-input"), { target: { files: [new File(["x"], "Песня.mp3", { type: "audio/mpeg" })] } });
    // Играет в теге audio
    expect(screen.getByTestId("media-element").tagName).toBe("AUDIO");
    // Убираем из списка
    fireEvent.click(screen.getByRole("button", { name: "Убрать «Песня»" }));
    // Адрес файла освобождён — память не течёт
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
    // Плеера больше нет
    expect(screen.queryByTestId("media-element")).not.toBeInTheDocument();
  });

  // Видео ставится на паузу вместе с плетением
  it("пауза и продолжение вместе с плетением", () => {
    // Шпион запуска видео
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    // Шпион паузы
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    // Рисуем
    weave();
    // Выбираем mp4
    fireEvent.change(screen.getByTestId("media-file-input"), { target: { files: [new File(["x"], "film.mp4", { type: "video/mp4" })] } });
    // Играет в теге video
    expect(screen.getByTestId("media-element").tagName).toBe("VIDEO");
    // «Старт» плетения
    fireEvent.click(screen.getByRole("button", { name: "Старт" }));
    // Видео запустилось
    expect(play).toHaveBeenCalledTimes(1);
    // «Пауза»
    fireEvent.click(screen.getByRole("button", { name: "Пауза" }));
    // Видео на паузе
    expect(pause).toHaveBeenCalledTimes(1);

    // Выключаем синхронизацию
    fireEvent.click(screen.getByRole("switch", { name: /Пауза вместе с плетением/ }));
    // «Старт»
    fireEvent.click(screen.getByRole("button", { name: "Старт" }));
    // Видео больше не запускается
    expect(play).toHaveBeenCalledTimes(1);
    // Выбор запомнен
    expect(localStorage.getItem("stringart.media.sync")).toBe("0");
  });

  // Музыка отдельно от видео
  it("музыка — отдельная графа: код Яндекс Музыки, название, запоминается", () => {
    // Рисуем
    weave();
    // Блок музыки
    const dock = screen.getByTestId("music-dock");
    // Вставляем код Яндекс Музыки
    fireEvent.change(within(dock).getByLabelText("Код Яндекс Музыки или ссылка"), { target: { value: YANDEX_CODE } });
    // «Добавить»
    fireEvent.click(within(dock).getByRole("button", { name: "Добавить" }));
    // Плеер музыки
    const frame = within(dock).getByTestId("music-frame");
    // Адрес виджета
    expect(frame).toHaveAttribute("src", "https://music.yandex.ru/iframe/playlist/alzhelez2018/3");
    // Свёрнут до 180 px
    expect(frame).toHaveStyle({ height: "180px" });
    // Название видно
    expect(dock).toHaveTextContent("Мне нравится — Alzhelez21");
    // «Развернуть плеер»
    fireEvent.click(within(dock).getByRole("button", { name: "Развернуть плеер" }));
    // Полная высота из кода
    expect(frame).toHaveStyle({ height: "556px" });
    // Музыка запомнена
    expect(loadMusic()).toHaveLength(1);
    // видео не тронуто: музыка играет отдельно
    expect(screen.queryByTestId("media-screen")).not.toBeInTheDocument();
  });

  // Кино на весь экран
  it("кино: на весь экран с шагом поверх; Esc — выход", async () => {
    // Рисуем
    weave();
    // Вставляем код VK
    fireEvent.change(screen.getByLabelText("Ссылка или код <iframe …>"), { target: { value: VK_CODE } });
    // «Добавить»
    fireEvent.click(within(screen.getByTestId("media-panel")).getByRole("button", { name: "Добавить" }));
    // в jsdom нет Fullscreen API — включается запасной режим «на всё окно»
    // Кнопка «Кино»
    fireEvent.click(screen.getByTestId("cinema-toggle"));
    // Поверх видео виден текущий шаг
    expect(await screen.findByTestId("cinema-hud")).toHaveTextContent("A1 → C1");
    // Esc
    fireEvent.keyDown(window, { key: "Escape" });
    // Подсказка поверх видео исчезла
    expect(screen.queryByTestId("cinema-hud")).not.toBeInTheDocument();
  });
});

// Группа: сигнал шага
describe("WeavePlayer: сигнал шага", () => {
  // Переключение вида сигнала
  it("переключает режим и запоминает его", () => {
    // Рисуем
    render(<WeavePlayer sequence={[0, 120, 30]} totalSteps={2} diameterCm={50} initialStep={1} initialSpeedSec={2} />);
    // Вкладка «Сигнал шага»
    fireEvent.click(screen.getByRole("tab", { name: /Сигнал шага/ }));
    // Группа переключателей
    const group = screen.getByRole("radiogroup", { name: "Сигнал шага" });
    // По умолчанию — сигнал
    expect(within(group).getByRole("radio", { name: /Сигнал/ })).toHaveAttribute("aria-checked", "true");
    // Есть громкость
    expect(screen.getByLabelText("Громкость сигнала")).toBeInTheDocument();
    // «Без звука»
    fireEvent.click(within(group).getByRole("radio", { name: /Без звука/ }));
    // Запомнено
    expect(readSoundPrefs().kind).toBe("none");
    // Громкости больше нет
    expect(screen.queryByLabelText("Громкость сигнала")).not.toBeInTheDocument();
    // В jsdom нет speechSynthesis — голос недоступен
    expect(within(group).getByRole("radio", { name: /Голос/ })).toBeDisabled();
  });
});
