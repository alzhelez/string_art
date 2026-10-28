// Компонент работает в браузере
"use client";

// Типы каталога и выбора нитей
import type { Palette, Swatch, ThreadChoice, ThreadMode } from "@/lib/api";

// Режимы для кнопок: значение, подпись, пояснение
const MODES: { value: ThreadMode; label: string; hint: string }[] = [
  // Классика
  { value: "mono", label: "Одна чёрная", hint: "Классика: чёрная леска на белой доске." },
  // Две нити
  { value: "bw", label: "Чёрная + белая", hint: "Белая нить даёт блики, чёрная — тени. Доска серая или цветная." },
  // Цветные
  { value: "color", label: "Цветные", hint: "2–4 цветные нити на белой доске, цвета подбираются под фото." },
];

// Свойства выбора нитей
interface Props {
  // Каталог с сервера (null — сервер старый, выбор недоступен)
  palette: Palette | null;
  // Текущий выбор
  value: ThreadChoice;
  // Изменение выбора
  onChange: (v: ThreadChoice) => void;
}

// Кружок цвета с подписью для экранного диктора
function Dot({ swatch }: { swatch: Swatch }) {
  // Кружок
  return <span className="swatch-dot" style={{ background: swatch.hex }} aria-hidden="true" />;
}

/** Выбор нитей портрета: одна чёрная, чёрная + белая или цветные; цвет доски и цвета нити. */
// Выбор нитей
export function ThreadPicker({ palette, value, onChange }: Props) {
  // Без каталога (старый сервер) — только одна чёрная нить, выбора нет
  if (!palette) return null;
  // Пояснение к текущему режиму
  const hint = MODES.find((m) => m.value === value.mode)?.hint;
  // Ключ доски: выбранный или по умолчанию для режима
  const board = value.board ?? palette.default_board[value.mode];
  // Цвета, выбранные вручную (пусто — подбор под фото)
  const manual = value.colors ?? [];
  // Переключить цвет вручную: добавить или убрать, не больше максимума
  const toggle = (key: string) => {
    // Уже выбран — убрать
    const next = manual.includes(key) ? manual.filter((k) => k !== key) : [...manual, key].slice(0, palette.colors.max);
    // Пусто — вернуться к подбору под фото
    onChange({ ...value, colors: next.length ? next : null });
  };
  // Мало цветов для ручного выбора
  const tooFew = value.mode === "color" && manual.length > 0 && manual.length < palette.colors.min;

  // Разметка
  return (
    // Группа «Нити»
    <fieldset className="thread-picker" data-testid="thread-picker">
      {/* Заголовок группы */}
      <legend>Нити</legend>
      {/* Режимы */}
      <div className="segmented-wide" role="radiogroup" aria-label="Нити">
        {/* Кнопка на каждый режим */}
        {MODES.map((m) => (
          // Кнопка-переключатель
          <button
            // Ключ
            key={m.value}
            // Тип
            type="button"
            // Роль
            role="radio"
            // Выбран ли
            aria-checked={value.mode === m.value}
            // Выбрать режим; доска и цвета — по умолчанию для нового режима
            onClick={() => onChange({ ...value, mode: m.value, board: null, colors: null })}
          >
            {/* Подпись */}
            {m.label}
          </button>
        ))}
      </div>
      {/* Пояснение */}
      <p className="field-hint">{hint}</p>

      {/* Цвет доски — для режимов из нескольких нитей */}
      {value.mode !== "mono" && (
        // Строка доски
        <div className="swatch-row">
          {/* Подпись */}
          <span className="swatch-label" id="board-label">
            {/* Текст */}
            Доска
          </span>
          {/* Варианты */}
          <div className="swatches" role="radiogroup" aria-labelledby="board-label">
            {/* Кнопка на каждый цвет доски */}
            {palette.boards.map((b) => (
              // Кнопка
              <button
                // Ключ
                key={b.key}
                // Тип
                type="button"
                // Роль
                role="radio"
                // Выбран ли
                aria-checked={board === b.key}
                // Подпись для диктора и подсказка
                aria-label={b.name}
                // Подсказка при наведении
                title={b.name}
                // Стиль
                className="swatch"
                // Выбрать
                onClick={() => onChange({ ...value, board: b.key })}
              >
                {/* Кружок цвета */}
                <Dot swatch={b} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Цветной режим: сколько цветов подобрать или какие взять */}
      {value.mode === "color" && (
        // Блок цветов
        <div className="color-choice">
          {/* Число цветов для подбора (только пока цвета не выбраны вручную) */}
          {!manual.length && (
            // Строка
            <div className="swatch-row">
              {/* Подпись */}
              <span className="swatch-label" id="count-label">
                {/* Текст */}
                Цветов
              </span>
              {/* Варианты 2–4 */}
              <div className="segmented" role="radiogroup" aria-labelledby="count-label">
                {/* Кнопка на каждое число */}
                {Array.from({ length: palette.colors.max - palette.colors.min + 1 }, (_, i) => palette.colors.min + i).map((n) => (
                  // Кнопка
                  <button key={n} type="button" role="radio" className="seg" aria-checked={value.color_count === n} onClick={() => onChange({ ...value, color_count: n })}>
                    {/* Число */}
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Цвета нитей: можно выбрать вручную */}
          <div className="swatch-row">
            {/* Подпись */}
            <span className="swatch-label" id="colors-label">
              {/* Свой выбор или приглашение выбрать */}
              {manual.length ? "Свои цвета" : "Или выберите сами"}
            </span>
            {/* Кнопки-флажки цветов */}
            <div className="swatches" role="group" aria-labelledby="colors-label">
              {/* Кнопка на каждую нить, кроме белой (на белой доске её не видно) */}
              {palette.threads
                // Без белой
                .filter((t) => t.key !== "white")
                // Кнопки
                .map((t) => (
                  // Кнопка-флажок
                  <button
                    // Ключ
                    key={t.key}
                    // Тип
                    type="button"
                    // Нажата ли
                    aria-pressed={manual.includes(t.key)}
                    // Подпись
                    aria-label={t.name}
                    // Подсказка
                    title={t.name}
                    // Стиль
                    className="swatch"
                    // Переключить
                    onClick={() => toggle(t.key)}
                    // Больше максимума выбрать нельзя
                    disabled={!manual.includes(t.key) && manual.length >= palette.colors.max}
                  >
                    {/* Кружок цвета */}
                    <Dot swatch={t} />
                  </button>
                ))}
            </div>
          </div>
          {/* Подсказка по ручному выбору */}
          <p className={`field-hint ${tooFew ? "is-warn" : ""}`} role={tooFew ? "alert" : undefined}>
            {/* Текст зависит от выбора */}
            {manual.length
              // Цвета выбраны вручную —
              ? tooFew
                // — мало
                ? `Выберите ещё хотя бы ${palette.colors.min - manual.length} цвет — или снимите все, и программа подберёт сама.`
                // — достаточно
                : `Выбрано ${manual.length} из ${palette.colors.max}. Снимите все — и цвета подберутся под фото.`
              // Подбор под фото
              : "Программа сама подберёт цвета, которые лучше всего передают фото; чёрная — всегда."}
          </p>
        </div>
      )}
      {/* Предупреждение о времени расчёта */}
      {value.mode !== "mono" && <p className="field-hint">Каждая нить плетётся отдельно, с гвоздя A1. Расчёт займёт 10–20 секунд.</p>}
    </fieldset>
  );
}

// Можно ли считать портрет с таким выбором (в цветном режиме — хватает ли цветов)
export function threadChoiceValid(v: ThreadChoice, palette: Palette | null): boolean {
  // Ручной выбор цветов — не меньше минимума
  return !(v.mode === "color" && v.colors && palette && v.colors.length < palette.colors.min);
}

// Цвет доски для превью в редакторе: null — серый кадр одной нити
export function previewBoard(v: ThreadChoice, palette: Palette | null): string | null {
  // Одна нить или нет каталога — серое превью
  if (v.mode === "mono" || !palette) return null;
  // Ключ доски
  const key = v.board ?? palette.default_board[v.mode];
  // HEX доски
  return palette.boards.find((b) => b.key === key)?.hex ?? "#ffffff";
}
