"use client";

import type { ReactNode } from "react";

/** Переключатель-«тумблер» на базе checkbox (role=switch): доступен с клавиатуры и для скринридеров. */
export function Switch({
  label,
  checked,
  disabled,
  onChange,
  hint,
  hintRole,
  testId,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  hint?: ReactNode;
  hintRole?: "alert";
  testId?: string;
}) {
  return (
    <div className={`switch-row ${disabled ? "is-disabled" : ""}`}>
      <label className="switch">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          data-testid={testId}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="switch-track" aria-hidden="true">
          <span className="switch-thumb" />
        </span>
        <span className="switch-label">{label}</span>
      </label>
      {hint && (
        <small className="switch-hint" role={hintRole}>
          {hint}
        </small>
      )}
    </div>
  );
}

/** Ползунок с подписью и значением; закрашенная часть дорожки — через CSS-переменную. */
export function Slider({
  id,
  label,
  min,
  max,
  step,
  value,
  display,
  onChange,
  testId,
  children,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: ReactNode;
  onChange: (v: number) => void;
  testId?: string;
  children?: ReactNode;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider-field">
      <div className="slider-head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} data-testid={testId}>
          {display}
        </output>
      </div>
      <input
        id={id}
        className="range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--fill": `${fill}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {children}
    </div>
  );
}

/** Карточка-секция с заголовком. */
export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="panel-section">
      <header className="panel-section-head">
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

/**
 * Вкладки. Все панели остаются в DOM (скрыты атрибутом hidden) — плееры внутри
 * не останавливаются при переключении.
 */
export function Tabs({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: { id: string; title: ReactNode; panel: ReactNode }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs">
      <div className="tab-list" role="tablist" aria-label={label}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={value === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={value === t.id ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              e.stopPropagation(); // стрелки здесь — для вкладок, а не для шагов плетения
              const i = tabs.findIndex((x) => x.id === value);
              const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
              onChange(next.id);
              document.getElementById(`tab-${next.id}`)?.focus();
            }}
          >
            {t.title}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={value !== t.id} className="tab-panel">
          {t.panel}
        </div>
      ))}
    </div>
  );
}
