// Компонент работает в браузере
"use client";

// Хуки React: запоминание расчёта и состояние
import { useMemo, useState } from "react";
// Числа и множественное число по-русски
import { num, plural } from "@/lib/format";
// План смен катушек
import { planSpools } from "@/lib/spool";

/** Своя катушка → на каких шагах её менять и на каком гвозде завязать узел. */
// Планировщик катушек
export function SpoolPlanner({
  // Последовательность
  sequence,
  // Число линий
  lines,
  // Диаметр
  diameterCm,
  // Стандартная катушка из расчёта
  standardSpoolM,
  // Своя катушка (null — не задана)
  ownSpoolM,
  // Сохранить свою катушку
  onChange,
// Типы свойств
}: {
  // Последовательность
  sequence: readonly number[];
  // Линии
  lines: number;
  // Диаметр
  diameterCm: number;
  // Стандартная катушка
  standardSpoolM: number;
  // Своя катушка
  ownSpoolM: number | null;
  // Обработчик
  onChange: (m: number | null) => void;
// Тело компонента
}) {
  // Текст поля
  const [value, setValue] = useState(ownSpoolM ? String(ownSpoolM) : "");
  // Какую катушку планируем: свою или стандартную
  const spool = ownSpoolM ?? standardSpoolM;
  // План пересчитывается только при смене входных данных (useMemo)
  const plan = useMemo(() => planSpools(sequence, lines, diameterCm, spool), [sequence, lines, diameterCm, spool]);
  // Разметка
  return (
    // Блок планировщика
    <div className="spool-planner" data-testid="spool-planner">
      {/* Поле «Моя катушка» */}
      <label className="inline-field">
        {/* Подпись слева */}
        <span>Моя катушка</span>
        {/* Числовое поле */}
        <input
          // Тип — число
          type="number"
          // Цифровая клавиатура на телефоне
          inputMode="decimal"
          // Минимум 10 м
          min={10}
          // Шаг стрелок — 10 м
          step={10}
          // Подсказка — стандартная катушка
          placeholder={String(standardSpoolM)}
          // Значение
          value={value}
          // Описание для экранного диктора
          aria-label="Длина моей катушки, м"
          // Ввод — только в поле
          onChange={(e) => setValue(e.target.value)}
          // Ушли из поля — применяем
          onBlur={() => {
            // Число (запятая тоже подходит)
            const n = Number(value.replace(",", "."));
            // Пусто — сброс на стандартную
            if (!value.trim()) onChange(null);
            // Правильное число — сохранить (округлив до метра)
            else if (Number.isFinite(n) && n >= 10) onChange(Math.round(n));
            // Иначе — вернуть прежнее значение
            else setValue(ownSpoolM ? String(ownSpoolM) : "");
          }}
        />
        {/* Единица */}
        <span>м</span>
      </label>
      {/* Хватит одной катушки? */}
      {plan.changes.length === 0 ? (
        // Да — абзац
        <p className="hint" data-testid="spool-plan">
          {/* Текст */}
          Одной катушки {num(spool)} м хватит на весь портрет.
        </p>
      // Нет
      ) : (
        // Фрагмент
        <>
          {/* Сколько катушек и как выбирается место узла */}
          <p className="hint" data-testid="spool-plan">
            {/* Текст пояснения */}
            Понадобится {plan.spools} {plural(plan.spools, ["катушка", "катушки", "катушек"])} по {num(spool)} м. Узел
            ставим на гвоздь, где больше всего нитей, — среди них его не видно. В режиме плетения за 40 шагов будет
            подсказка.
          </p>
          {/* Список смен */}
          <ol className="spool-list">
            {/* Пункт на каждую смену */}
            {plan.changes.map((c) => (
              // Пункт
              <li key={c.afterStep}>
                {/* После какого шага и на каком гвозде узел */}
                После шага <strong>{num(c.afterStep)}</strong> — узел на <strong>{c.label}</strong>, новая катушка
                {/* Сколько лески уйдёт к этому моменту */}
                <span className="muted"> (уйдёт ≈ {num(c.usedM)} м)</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
