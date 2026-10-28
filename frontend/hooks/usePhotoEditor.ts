// Хук работает в браузере
"use client";

// Хуки React
import { useCallback, useEffect, useRef, useState } from "react";
// Запросы к API, тип ошибки и типы данных
import { api, ApiError, type AutoTone, type Features, type ImageInfo } from "@/lib/api";
// Ограничение настроек, настройки по умолчанию, нормализация центра кадра
import { clampPrep, DEFAULT_PREP, normalizeCenter, type Prep } from "@/lib/prep";

// Состояние маски фона в редакторе
export type MaskStatus = "idle" | "loading" | "ready" | "error";

// Ответ сервера о маске
interface MaskState {
  // Состояние расчёта
  status: "idle" | "processing" | "ready" | "error";
  // Состояние модели
  model: string;
  // Текст ошибки
  message: string | null;
  // Маска поправлена кистью
  edited?: boolean;
  // Прогресс скачивания модели
  progress?: number | null;
}

/** Инструмент в окне кадра: двигать кадр или поправлять маску фона кистью. */
// Тип инструмента
export type BrushTool = "move" | "erase" | "restore";

// Сколько шагов кисти можно отменить
const UNDO_LIMIT = 8;

/** Маска как редактируемый canvas в размере самой маски (= размер фото). */
// Создать холст из картинки маски
function maskCanvas(img: HTMLImageElement): HTMLCanvasElement {
  // Новый холст
  const c = document.createElement("canvas");
  // Ширина — как у картинки
  c.width = img.naturalWidth || img.width;
  // Высота
  c.height = img.naturalHeight || img.height;
  // Рисуем картинку маски на холст (willReadFrequently — будем читать пиксели)
  c.getContext("2d", { willReadFrequently: true })?.drawImage(img, 0, 0);
  // Готовый холст
  return c;
}

// Запрос статуса маски (POST — запустить, GET — узнать)
async function maskRequest(id: string, method: "GET" | "POST"): Promise<MaskState> {
  // Ответ
  let res: Response;
  // Сеть может быть недоступна
  try {
    // Запрос
    res = await fetch(`/api/images/${id}/mask`, { method });
  // Нет связи
  } catch {
    // Понятная ошибка
    throw new Error("Сервер не отвечает. Проверьте, что бэкенд запущен.");
  }
  // Тело ответа (если не JSON — пустой объект)
  const body = await res.json().catch(() => ({}));
  // Ошибка, кроме 202 «принято, считается»
  if (!res.ok && res.status !== 202) {
    // Текст из ответа сервера или код
    throw new Error(typeof body.detail === "string" ? body.detail : `Ошибка ${res.status}`);
  }
  // Статус маски
  return body as MaskState;
}

// Загрузить картинку и дождаться её декодирования
async function loadImage(url: string): Promise<HTMLImageElement> {
  // Новый элемент картинки
  const img = new Image();
  // Декодировать в фоне, не подвешивая страницу
  img.decoding = "async";
  // Адрес
  img.src = url;
  // Ждём, пока картинка полностью готова (ошибка → исключение)
  await img.decode();
  // Готовая картинка
  return img;
}

// Пауза на ms миллисекунд
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Состояние редактора: само фото, маска фона и параметры кадра. */
// Хук редактора фото
export function usePhotoEditor(info: ImageInfo | null, initial?: Partial<Prep>) {
  // Оригинал фото
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  // Фото не загрузилось
  const [imageError, setImageError] = useState(false);
  // Маска фона как холст (её правит кисть)
  const [mask, setMask] = useState<HTMLCanvasElement | null>(null);
  // Счётчик правок маски — сигнал перерисовать кадр
  const [maskVersion, setMaskVersion] = useState(0);
  // Маска поправлена кистью
  const [maskEdited, setMaskEdited] = useState(false);
  // Инструмент: двигать / стереть / вернуть
  const [tool, setTool] = useState<BrushTool>("move");
  // Размер кисти — доля стороны кадра
  const [brushSize, setBrushSize] = useState(0.04);
  // Есть ли что отменять
  const [canUndo, setCanUndo] = useState(false);
  // Снимки маски для отмены
  const undoStack = useRef<ImageData[]>([]);
  // Последняя точка кисти (для рисования линией между точками)
  const lastPoint = useRef<{ x: number; y: number; r: number } | null>(null);
  // Есть несохранённые правки маски
  const dirty = useRef(false);
  // Таймер отложенной отправки маски
  const uploadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Цепочка отправок маски (по очереди, не параллельно)
  const uploading = useRef<Promise<void>>(Promise.resolve());
  // Номер запланированного кадра анимации
  const frame = useRef(0);
  // Состояние маски
  const [maskStatus, setMaskStatus] = useState<MaskStatus>("idle");
  // Ошибка маски
  const [maskError, setMaskError] = useState("");
  // Подсказка (скачивание модели и т. п.)
  const [maskNote, setMaskNote] = useState("");
  // Настройки кадра (начальные — по умолчанию или из проекта)
  const [prep, setPrepState] = useState<Prep>({ ...DEFAULT_PREP, ...initial });
  // Текущая задача расчёта маски
  const maskJob = useRef<{ id: string; promise: Promise<boolean> } | null>(null);
  // Компонент ещё на экране
  const alive = useRef(true);

  // Отслеживаем, жив ли компонент
  useEffect(() => {
    // Появился
    alive.current = true;
    // При исчезновении
    return () => {
      // Больше не жив
      alive.current = false;
    };
  // Один раз
  }, []);

  // Сменилось фото — сбрасываем всё и загружаем новое
  useEffect(() => {
    // Старое фото убираем
    setImage(null);
    // Маску тоже
    setMask(null);
    // Статус маски
    setMaskStatus("idle");
    // Признак правки
    setMaskEdited(false);
    // Инструмент — двигать
    setTool("move");
    // Отмены
    undoStack.current = [];
    // Нечего отменять
    setCanUndo(false);
    // Несохранённых правок нет
    dirty.current = false;
    // Задачи маски нет
    maskJob.current = null;
    // Фото нет — всё
    if (!info) return;
    // Флаг «этот эффект ещё актуален»
    let current = true;
    // Ошибки пока нет
    setImageError(false);
    // Сервер мог быть занят (первый запуск, скачивание модели) — пробуем ещё пару раз
    // Загрузка с повторами
    (async () => {
      // До трёх попыток
      for (let attempt = 0; attempt < 3 && current; attempt++) {
        // Загрузка может не удаться
        try {
          // Загружаем оригинал
          const img = await loadImage(api.imageUrl(info.id));
          // Если всё ещё актуально — показываем
          if (current) setImage(img);
          // Готово
          return;
        // Не получилось
        } catch {
          // Ждём 1, 2, 3 секунды перед следующей попыткой
          await sleep(1000 * (attempt + 1));
        }
      }
      // Все попытки неудачны — показываем ошибку
      if (current) setImageError(true);
    })();
    // При смене фото или уходе
    return () => {
      // Результат старой загрузки больше не нужен
      current = false;
    };
  // При смене фото
  }, [info]);

  // Установить настройки кадра
  const setPrep = useCallback(
    // Новые настройки
    (next: Prep) => {
      // Ограничиваем пределами
      const p = clampPrep(next);
      // И подтягиваем центр к фактическому кадру (если фото известно)
      setPrepState(info ? normalizeCenter(info.width, info.height, p) : p);
    },
    // Зависимости
    [info],
  );

  /**
   * Маска фона считается на сервере в фоне: запускаем задачу и опрашиваем статус.
   * Ни один запрос не висит долго (прокси Next.js обрывает их через 30 с).
   * Возвращает true, когда маска загружена.
   */
  // Получить маску (запустить расчёт и дождаться)
  const ensureMask = useCallback((): Promise<boolean> => {
    // Фото нет
    if (!info) return Promise.resolve(false);
    // Для этого фото задача уже идёт — ждём её же
    if (maskJob.current?.id === info.id) return maskJob.current.promise;
    // id фото
    const id = info.id;
    // Статус «загружается»
    setMaskStatus("loading");
    // Ошибку сбрасываем
    setMaskError("");
    // Подсказку тоже
    setMaskNote("");
    // Сама задача
    const promise = (async () => {
      // Любая ошибка обрабатывается в catch
      try {
        // Запускаем расчёт
        let st = await maskRequest(id, "POST");
        // Пока не готово
        while (st.status !== "ready") {
          // Ушли со страницы — прекращаем
          if (!alive.current) return false;
          // Ошибка на сервере
          if (st.status === "error") throw new Error(st.message ?? "Не удалось убрать фон");
          // Показываем, что происходит
          setMaskNote(
            // Модель грузится?
            st.model === "loading"
              // Известен прогресс скачивания?
              ? typeof st.progress === "number"
                // Скачивается, с процентами
                ? `Скачиваем модель удаления фона: ${Math.round(st.progress * 100)} % из ~170 МБ. Это нужно один раз.`
                // Грузится, без процентов
                : "Загружаем модель удаления фона. В самый первый раз она скачивается (~170 МБ) — это может занять несколько минут."
              // Модель готова — считается маска
              : "Убираем фон…",
          );
          // Ждём секунду
          await sleep(1000);
          // Спрашиваем снова
          st = await maskRequest(id, "GET");
        }
        // Загружаем готовую маску (?v= — чтобы браузер не взял старую из кэша)
        const img = await loadImage(`${api.maskUrl(id)}?v=${Date.now()}`);
        // Ушли — выходим
        if (!alive.current) return false;
        // Маска → холст для кисти
        setMask(maskCanvas(img));
        // Поправлена ли кистью
        setMaskEdited(Boolean(st.edited));
        // Готово
        setMaskStatus("ready");
        // Подсказку убираем
        setMaskNote("");
        // Успех
        return true;
      // Ошибка
      } catch (e) {
        // Задачу сбрасываем — можно попробовать снова
        maskJob.current = null;
        // Компонент ещё на экране
        if (alive.current) {
          // Статус ошибки
          setMaskStatus("error");
          // Текст
          setMaskError(e instanceof Error ? e.message : "Не удалось убрать фон");
          // Снимаем галочку «Убрать фон»
          setPrepState((p) => ({ ...p, remove_background: false }));
        }
        // Неудача
        return false;
      }
    // Запускаем немедленно
    })();
    // Запоминаем задачу
    maskJob.current = { id, promise };
    // Отдаём обещание результата
    return promise;
  // Пересоздаётся при смене фото
  }, [info]);

  // Включили «Убрать фон» — нужна маска
  useEffect(() => {
    // Запускаем расчёт (void — результат здесь не ждём)
    if (prep.remove_background) void ensureMask();
  // При смене флага
  }, [prep.remove_background, ensureMask]);

  // Запросить перерисовку кадра (не чаще одного раза за кадр экрана)
  // --- кисть: правка маски фона -------------------------------------------------
  // Функция bump
  const bump = useCallback(() => {
    // Уже запланировано
    if (frame.current) return;
    // Планируем на следующий кадр
    frame.current = requestAnimationFrame(() => {
      // Кадр наступил
      frame.current = 0;
      // Увеличиваем счётчик — окно кадра перерисуется
      setMaskVersion((v) => v + 1);
    });
  // Создаётся один раз
  }, []);

  // Отправить маску на сервер
  const upload = useCallback(async () => {
    // Нечего или незачем
    if (!info || !mask || !dirty.current) return;
    // Отправляем — правки больше не «грязные»
    dirty.current = false;
    // Холст → PNG
    const blob = await new Promise<Blob | null>((resolve) => mask.toBlob(resolve, "image/png"));
    // Не получилось
    if (!blob) return;
    // PUT-запрос с PNG
    const res = await fetch(`/api/images/${info.id}/mask.png`, {
      // Метод
      method: "PUT",
      // Тип тела
      headers: { "Content-Type": "image/png" },
      // Сама маска
      body: blob,
    // Ошибка сети → null
    }).catch(() => null);
    // Не сохранилось
    if (!res?.ok) {
      // Снова «грязная» — попробуем позже
      dirty.current = true;
      // Сообщаем человеку
      if (alive.current) setMaskError("Правка фона не сохранилась — проверьте связь с сервером.");
      // Выход
      return;
    }
    // Сохранилось
    if (alive.current) {
      // Признак правки
      setMaskEdited(true);
      // Ошибку убираем
      setMaskError("");
    }
  // Зависимости
  }, [info, mask]);

  // Запланировать отправку маски через 600 мс после последнего мазка
  const scheduleUpload = useCallback(() => {
    // Есть несохранённое
    dirty.current = true;
    // Сбрасываем прежний таймер
    if (uploadTimer.current) clearTimeout(uploadTimer.current);
    // Новый таймер
    uploadTimer.current = setTimeout(() => {
      // Таймер сработал
      uploadTimer.current = null;
      // Отправка встаёт в очередь за предыдущей
      uploading.current = uploading.current.then(upload);
    // Задержка 600 мс
    }, 600);
  // Зависимости
  }, [upload]);

  /** Дождаться, пока правки кистью дойдут до сервера (перед расчётом портрета). */
  // Отправить немедленно и дождаться
  const flushMask = useCallback(async () => {
    // Есть запланированная отправка
    if (uploadTimer.current) {
      // Отменяем таймер
      clearTimeout(uploadTimer.current);
      // Таймера нет
      uploadTimer.current = null;
      // Отправляем сейчас
      uploading.current = uploading.current.then(upload);
    }
    // Ждём окончания всех отправок
    await uploading.current;
  // Зависимости
  }, [upload]);

  // Нарисовать мазок кисти на маске
  const paint = useCallback(
    // Отрезок от (x0, y0) до (x1, y1) радиусом r; режим стереть/вернуть
    (x0: number, y0: number, x1: number, y1: number, r: number, mode: BrushTool) => {
      // Контекст холста маски
      const ctx = mask?.getContext("2d");
      // Нет маски или фото
      if (!ctx || !info) return;
      // Масштаб: пиксели маски на пиксель фото
      const k = mask!.width / info.width; // маска и фото одного размера, но на всякий случай
      // Запомнить настройки
      ctx.save();
      // Стереть — чёрным (фон), вернуть — белым (человек)
      ctx.strokeStyle = ctx.fillStyle = mode === "erase" ? "#000" : "#fff";
      // Толщина — диаметр кисти
      ctx.lineWidth = 2 * r * k;
      // Скруглённые концы и стыки
      ctx.lineCap = ctx.lineJoin = "round";
      // Новая фигура
      ctx.beginPath();
      // Начало
      ctx.moveTo(x0 * k, y0 * k);
      // Конец (+0,01 — чтобы точка без движения тоже нарисовалась)
      ctx.lineTo(x1 * k + 0.01, y1 * k);
      // Провести
      ctx.stroke();
      // Вернуть настройки
      ctx.restore();
      // Перерисовать кадр
      bump();
    },
    // Зависимости
    [mask, info, bump],
  );

  /** Кисть: координаты — в пикселях исходного фото, r — радиус там же. */
  // Обработчики кисти для окна кадра
  const brush = {
    // Начало мазка
    begin: (x: number, y: number, r: number) => {
      // Контекст маски
      const ctx = mask?.getContext("2d", { willReadFrequently: true });
      // Нет маски или режим «двигать»
      if (!ctx || tool === "move") return;
      // Снимок для отмены
      undoStack.current.push(ctx.getImageData(0, 0, mask!.width, mask!.height));
      // Храним не больше 8 снимков
      if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
      // Есть что отменять
      setCanUndo(true);
      // Запоминаем точку
      lastPoint.current = { x, y, r };
      // Рисуем точку
      paint(x, y, x, y, r, tool);
    },
    // Движение
    move: (x: number, y: number) => {
      // Предыдущая точка
      const last = lastPoint.current;
      // Мазок не начат
      if (!last) return;
      // Линия от предыдущей точки
      paint(last.x, last.y, x, y, last.r, tool);
      // Новая предыдущая точка
      lastPoint.current = { ...last, x, y };
    },
    // Конец мазка
    end: () => {
      // Мазка не было
      if (!lastPoint.current) return;
      // Сбрасываем
      lastPoint.current = null;
      // Отправляем маску (с задержкой)
      scheduleUpload();
    },
  };

  // Отменить последний мазок
  const undo = useCallback(() => {
    // Контекст
    const ctx = mask?.getContext("2d");
    // Последний снимок
    const snap = undoStack.current.pop();
    // Есть что восстанавливать
    if (ctx && snap) {
      // Возвращаем пиксели
      ctx.putImageData(snap, 0, 0);
      // Перерисовать
      bump();
      // Сохранить на сервер
      scheduleUpload();
    }
    // Остались ли ещё снимки
    setCanUndo(undoStack.current.length > 0);
  // Зависимости
  }, [mask, bump, scheduleUpload]);

  /** Вернуть автоматическую маску (отменить все правки кистью). */
  // Сбросить правки кистью
  const resetMask = useCallback(async () => {
    // Нет фото
    if (!info) return;
    // Отменяем запланированную отправку
    if (uploadTimer.current) clearTimeout(uploadTimer.current);
    // Таймера нет
    uploadTimer.current = null;
    // Отправлять нечего
    dirty.current = false;
    // Ждём уже начатые отправки
    await uploading.current;
    // Просим сервер вернуть автоматическую маску
    await fetch(`/api/images/${info.id}/mask/edits`, { method: "DELETE" }).catch(() => null);
    // Отмены больше не нужны
    undoStack.current = [];
    // Нечего отменять
    setCanUndo(false);
    // Задачу маски сбрасываем
    maskJob.current = null;
    // Загружаем автоматическую маску заново
    await ensureMask();
  // Зависимости
  }, [info, ensureMask]);

  // Кисть доступна только с готовой маской
  useEffect(() => {
    // Иначе — инструмент «двигать»
    if (!prep.remove_background || maskStatus !== "ready") setTool("move");
  // При смене флага или статуса
  }, [prep.remove_background, maskStatus]);

  // Всё, что нужно редактору
  return {
    // Оригинал фото
    image,
    // Ошибка загрузки фото
    imageError,
    // Холст маски
    mask,
    // Счётчик правок маски
    maskVersion,
    // Состояние маски
    maskStatus,
    // Ошибка маски
    maskError,
    // Подсказка о маске
    maskNote,
    // Поправлена ли кистью
    maskEdited,
    // Настройки кадра
    prep,
    // Установить настройки
    setPrep,
    // Получить маску
    ensureMask,
    // Дождаться отправки правок маски
    flushMask,
    // Инструмент
    tool,
    // Сменить инструмент
    setTool,
    // Размер кисти
    brushSize,
    // Сменить размер кисти
    setBrushSize,
    // Обработчики кисти
    brush,
    // Можно ли отменить
    canUndo,
    // Отменить мазок
    undo,
    // Сбросить правки
    resetMask,
  };
}

// Этапы автонастройки
export type AutoStage = "idle" | "frame" | "background" | "tone" | "done" | "error";

/**
 * «Автонастройка»: кадр по лицу → удаление фона → подбор яркости и контраста
 * перебором на сервере (по сходству нитяной картины с исходным фото).
 */
// Хук автонастройки
export function useAutoPrep(
  // Фото
  info: ImageInfo | null,
  // Возможности сервера
  features: Features | null,
  // Редактор (его настройки и маска)
  editor: ReturnType<typeof usePhotoEditor>,
  // Диаметр доски
  diameterCm: number,
// Тело хука
) {
  // Этап
  const [stage, setStage] = useState<AutoStage>("idle");
  // Результат
  const [result, setResult] = useState<AutoTone | null>(null);
  // Ошибка
  const [error, setError] = useState("");
  // Нужное из редактора
  const { prep, setPrep, ensureMask, flushMask } = editor;

  // Запуск автонастройки
  const run = useCallback(async () => {
    // Фото нет
    if (!info) return;
    // Сбрасываем ошибку
    setError("");
    // И прошлый результат
    setResult(null);
    // Любая ошибка — в catch
    try {
      // Начинаем с текущего кадра без коррекций
      let next: Prep = { ...prep, brightness: 0, contrast: 0 };
      // Этап «кадр»
      setStage("frame");
      // Готовый кадр по лицу (если сервер ищет лица и лицо нашлось)
      const face = features?.face_detection ? info.face_prep : null;
      // Есть лицо
      if (face) {
        // Кадр по лицу и «Выделить лицо»
        next = { ...next, center_x: face.center_x, center_y: face.center_y, zoom: face.zoom, face_focus: true };
      }
      // Можно убрать фон и есть лицо (на фото человек)
      if (features?.background_removal && face) {
        // Включаем «Убрать фон»
        next = { ...next, remove_background: true };
        // Показываем
        setPrep(next);
        // Этап «фон»
        setStage("background");
        // Ждём маску; не получилось — без удаления фона
        if (!(await ensureMask())) next = { ...next, remove_background: false };
      }
      // Применяем кадр
      setPrep(next);
      // Этап «тон»
      setStage("tone");
      // Правки маски кистью должны дойти до сервера
      await flushMask();
      // Подбор на сервере
      const tone = await api.autoTone(info.id, next, diameterCm);
      // Применяем подобранные яркость и контраст
      setPrep({ ...next, brightness: tone.brightness, contrast: tone.contrast });
      // Результат для показа
      setResult(tone);
      // Готово
      setStage("done");
    // Ошибка
    } catch (e) {
      // Текст ошибки
      setError(e instanceof ApiError ? e.message : "Автонастройка не удалась.");
      // Этап «ошибка»
      setStage("error");
    }
  // Зависимости
  }, [info, features, prep, setPrep, ensureMask, flushMask, diameterCm]);

  // Наружу; busy — идёт работа (кнопки блокируются)
  return { run, stage, result, error, busy: stage === "frame" || stage === "background" || stage === "tone" };
}
