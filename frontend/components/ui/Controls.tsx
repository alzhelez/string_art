// Компоненты работают в браузере
"use client";

// Тип «что угодно, что React может нарисовать»
import type { ReactNode } from "react";

/** Переключатель-«тумблер» на базе checkbox (role=switch): доступен с клавиатуры и для скринридеров. */
// Переключатель
export function Switch({
  // Подпись
  label,
  // Включён ли
  checked,
  // Неактивен
  disabled,
  // Сообщить новое значение
  onChange,
  // Пояснение под переключателем
  hint,
  // Роль пояснения (alert — для ошибок, читается сразу)
  hintRole,
  // Метка для автотестов
  testId,
// Типы свойств
}: {
  // Подпись — строка
  label: string;
  // Включён — да/нет
  checked: boolean;
  // Неактивен — необязательно
  disabled?: boolean;
  // Обработчик
  onChange: (v: boolean) => void;
  // Пояснение — что угодно
  hint?: ReactNode;
  // Роль — только alert
  hintRole?: "alert";
  // Метка
  testId?: string;
// Тело компонента
}) {
  // Разметка
  return (
    // Строка переключателя; у неактивного — свой стиль
    <div className={`switch-row ${disabled ? "is-disabled" : ""}`}>
      {/* Вся строка кликабельна (label) */}
      <label className="switch">
        {/* Настоящий чекбокс (виден только экранному диктору и клавиатуре) */}
        <input
          // Тип — флажок
          type="checkbox"
          // Роль — переключатель
          role="switch"
          // Состояние
          checked={checked}
          // Неактивен
          disabled={disabled}
          // Метка для тестов
          data-testid={testId}
          // Сообщить новое значение
          onChange={(e) => onChange(e.target.checked)}
        />
        {/* Нарисованная дорожка */}
        <span className="switch-track" aria-hidden="true">
          {/* Кружок */}
          <span className="switch-thumb" />
        </span>
        {/* Подпись */}
        <span className="switch-label">{label}</span>
      </label>
      {/* Пояснение, если есть */}
      {hint && (
        // Мелкий текст
        <small className="switch-hint" role={hintRole}>
          {/* Содержимое пояснения */}
          {hint}
        </small>
      )}
    </div>
  );
}

/** Ползунок с подписью и значением; закрашенная часть дорожки — через CSS-переменную. */
// Ползунок
export function Slider({
  // id поля
  id,
  // Подпись
  label,
  // Минимум
  min,
  // Максимум
  max,
  // Шаг
  step,
  // Значение
  value,
  // Как показать значение (например, «×2,25»)
  display,
  // Обработчик
  onChange,
  // Метка для тестов
  testId,
  // Дополнительное содержимое под ползунком
  children,
// Типы свойств
}: {
  // id — строка
  id: string;
  // Подпись
  label: string;
  // Минимум
  min: number;
  // Максимум
  max: number;
  // Шаг
  step: number;
  // Значение
  value: number;
  // Показ значения
  display: ReactNode;
  // Обработчик
  onChange: (v: number) => void;
  // Метка
  testId?: string;
  // Дополнительное
  children?: ReactNode;
// Тело компонента
}) {
  // Доля закрашенной дорожки в процентах
  const fill = ((value - min) / (max - min)) * 100;
  // Разметка
  return (
    // Блок ползунка
    <div className="slider-field">
      {/* Строка: подпись и значение */}
      <div className="slider-head">
        {/* Подпись, связанная с полем */}
        <label htmlFor={id}>{label}</label>
        {/* Значение (output — элемент для результата) */}
        <output htmlFor={id} data-testid={testId}>
          {/* Показ значения */}
          {display}
        </output>
      </div>
      {/* Сам ползунок */}
      <input
        // id для подписи
        id={id}
        // Стиль
        className="range"
        // Тип — ползунок
        type="range"
        // Минимум
        min={min}
        // Максимум
        max={max}
        // Шаг
        step={step}
        // Значение
        value={value}
        // CSS-переменная --fill закрашивает дорожку до текущего значения
        style={{ "--fill": `${fill}%` } as React.CSSProperties}
        // Сообщить число
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {/* Дополнительное содержимое */}
      {children}
    </div>
  );
}

/** Карточка-секция с заголовком. */
// Секция с заголовком
export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  // Разметка
  return (
    // Секция
    <section className="panel-section">
      {/* Шапка секции */}
      <header className="panel-section-head">
        {/* Заголовок */}
        <h2>{title}</h2>
        {/* Дополнительный элемент справа */}
        {aside}
      </header>
      {/* Содержимое */}
      {children}
    </section>
  );
}

/**
 * Вкладки. Все панели остаются в DOM (скрыты атрибутом hidden) — плееры внутри
 * не останавливаются при переключении.
 */
// Вкладки
export function Tabs({
  // Подпись группы вкладок
  label,
  // Вкладки: id, заголовок, содержимое
  tabs,
  // Активная вкладка
  value,
  // Переключение
  onChange,
// Типы свойств
}: {
  // Подпись
  label: string;
  // Список вкладок
  tabs: { id: string; title: ReactNode; panel: ReactNode }[];
  // Активная
  value: string;
  // Обработчик
  onChange: (id: string) => void;
// Тело компонента
}) {
  // Разметка
  return (
    // Блок вкладок
    <div className="tabs">
      {/* Ряд заголовков (роль «список вкладок») */}
      <div className="tab-list" role="tablist" aria-label={label}>
        {/* Кнопка на каждую вкладку */}
        {tabs.map((t) => (
          // Кнопка-вкладка
          <button
            // Ключ
            key={t.id}
            // Обычная кнопка
            type="button"
            // Роль «вкладка»
            role="tab"
            // id — на него ссылается панель
            id={`tab-${t.id}`}
            // Выбрана ли
            aria-selected={value === t.id}
            // Какую панель открывает
            aria-controls={`panel-${t.id}`}
            // В порядке Tab доступна только активная вкладка (по остальным — стрелками)
            tabIndex={value === t.id ? 0 : -1}
            // Нажатие — выбрать
            onClick={() => onChange(t.id)}
            // Клавиши
            onKeyDown={(e) => {
              // Нас интересуют только стрелки влево/вправо
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              // Не прокручивать страницу
              e.preventDefault();
              // Не передавать нажатие дальше
              e.stopPropagation(); // стрелки здесь — для вкладок, а не для шагов плетения
              // Номер активной вкладки
              const i = tabs.findIndex((x) => x.id === value);
              // Следующая или предыдущая по кругу
              const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
              // Выбрать
              onChange(next.id);
              // Перевести фокус на неё
              document.getElementById(`tab-${next.id}`)?.focus();
            }}
          >
            {/* Заголовок вкладки */}
            {t.title}
          </button>
        ))}
      </div>
      {/* Панели */}
      {tabs.map((t) => (
        // Панель; hidden — скрыта, но остаётся на странице (видео в ней не останавливается)
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={value !== t.id} className="tab-panel">
          {/* Содержимое */}
          {t.panel}
        </div>
      ))}
    </div>
  );
}
