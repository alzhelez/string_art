// Компонент работает в браузере
"use client";

// Хуки React
import { useEffect, useState } from "react";
// Пресеты и пределы диаметра
import { DIAMETER_PRESETS_CM, MAX_DIAMETER_CM, MIN_DIAMETER_CM } from "@/lib/constants";

// Свойства компонента
interface Props {
  // Текущий диаметр
  value: number;
  // Сообщить новый диаметр
  onChange: (cm: number) => void;
  // id поля ввода (для подписи)
  id?: string;
}

/** Пресеты 30–70 см и своё значение. Невалидный ввод не уходит наружу. */
// Выбор диаметра: кнопки-пресеты и поле «своё»
export function DiameterPicker({ value, onChange, id = "diameter" }: Props) {
  // Текущее значение — один из пресетов?
  const isPreset = (DIAMETER_PRESETS_CM as readonly number[]).includes(value);
  // Текст поля «своё» (пусто, если выбран пресет)
  const [custom, setCustom] = useState(isPreset ? "" : String(value));
  // Ошибка ввода
  const [error, setError] = useState("");

  // Значение сменилось снаружи
  useEffect(() => {
    // Если это пресет — очищаем поле «своё»
    if ((DIAMETER_PRESETS_CM as readonly number[]).includes(value)) setCustom("");
  // При смене value
  }, [value]);

  // Ввод в поле «своё»
  const commitCustom = (raw: string) => {
    // Показываем, что ввели
    setCustom(raw);
    // Поле очистили
    if (raw.trim() === "") {
      // Ошибки нет
      setError("");
      // Ничего не меняем
      return;
    }
    // Число (запятая тоже подходит)
    const n = Number(raw.replace(",", "."));
    // Не число или вне пределов
    if (!Number.isFinite(n) || n < MIN_DIAMETER_CM || n > MAX_DIAMETER_CM) {
      // Сообщение с пределами
      setError(`Диаметр от ${MIN_DIAMETER_CM} до ${MAX_DIAMETER_CM} см`);
      // Наружу не отправляем
      return;
    }
    // Всё хорошо
    setError("");
    // Отправляем с точностью до миллиметра
    onChange(Math.round(n * 10) / 10);
  };

  // Разметка
  return (
    // Группа полей
    <fieldset className="diameter">
      {/* Заголовок группы */}
      <legend>Диаметр круга</legend>
      {/* Сегменты-кнопки; для экранного диктора — группа переключателей */}
      <div className="segmented" role="radiogroup" aria-label="Диаметр круга">
        {/* Кнопка на каждый пресет */}
        {DIAMETER_PRESETS_CM.map((cm) => (
          // Кнопка
          <button
            // Ключ элемента списка
            key={cm}
            // Обычная кнопка
            type="button"
            // Роль «переключатель»
            role="radio"
            // Выбран, если совпадает и поле «своё» пусто
            aria-checked={value === cm && custom === ""}
            // Стиль сегмента
            className="seg"
            // Нажатие
            onClick={() => {
              // Очистить «своё»
              setCustom("");
              // Ошибку
              setError("");
              // Сообщить диаметр
              onChange(cm);
            }}
          >
            {/* Число на кнопке */}
            {cm}
          </button>
        ))}
        {/* Поле «своё» */}
        <label className="seg-custom">
          {/* Поле ввода */}
          <input
            // id для подписи
            id={id}
            // Текстовое (number в браузерах неудобно с запятой)
            type="text"
            // Цифровая клавиатура на телефоне
            inputMode="decimal"
            // Подсказка в пустом поле
            placeholder="своё"
            // Подпись для экранного диктора
            aria-label="Свой диаметр, см"
            // Признак ошибки
            aria-invalid={error !== ""}
            // Значение
            value={custom}
            // Ввод
            onChange={(e) => commitCustom(e.target.value)}
          />
          {/* Единица измерения */}
          <span>см</span>
        </label>
      </div>
      {/* Ошибка (если есть) */}
      {error && (
        // Абзац с ошибкой; role="alert" — экранный диктор прочитает сразу
        <p className="field-error" role="alert">
          {/* Текст ошибки */}
          {error}
        </p>
      )}
    </fieldset>
  );
}
