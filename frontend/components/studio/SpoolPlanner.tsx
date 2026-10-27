"use client";

import { useMemo, useState } from "react";
import { num, plural } from "@/lib/format";
import { planSpools } from "@/lib/spool";

/** Своя катушка → на каких шагах её менять и на каком гвозде завязать узел. */
export function SpoolPlanner({
  sequence,
  lines,
  diameterCm,
  standardSpoolM,
  ownSpoolM,
  onChange,
}: {
  sequence: readonly number[];
  lines: number;
  diameterCm: number;
  standardSpoolM: number;
  ownSpoolM: number | null;
  onChange: (m: number | null) => void;
}) {
  const [value, setValue] = useState(ownSpoolM ? String(ownSpoolM) : "");
  const spool = ownSpoolM ?? standardSpoolM;
  const plan = useMemo(() => planSpools(sequence, lines, diameterCm, spool), [sequence, lines, diameterCm, spool]);
  return (
    <div className="spool-planner" data-testid="spool-planner">
      <label className="inline-field">
        <span>Моя катушка</span>
        <input
          type="number"
          inputMode="decimal"
          min={10}
          step={10}
          placeholder={String(standardSpoolM)}
          value={value}
          aria-label="Длина моей катушки, м"
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            const n = Number(value.replace(",", "."));
            if (!value.trim()) onChange(null);
            else if (Number.isFinite(n) && n >= 10) onChange(Math.round(n));
            else setValue(ownSpoolM ? String(ownSpoolM) : "");
          }}
        />
        <span>м</span>
      </label>
      {plan.changes.length === 0 ? (
        <p className="hint" data-testid="spool-plan">
          Одной катушки {num(spool)} м хватит на весь портрет.
        </p>
      ) : (
        <>
          <p className="hint" data-testid="spool-plan">
            Понадобится {plan.spools} {plural(plan.spools, ["катушка", "катушки", "катушек"])} по {num(spool)} м. Узел
            ставим на гвоздь, где больше всего нитей, — среди них его не видно. В режиме плетения за 40 шагов будет
            подсказка.
          </p>
          <ol className="spool-list">
            {plan.changes.map((c) => (
              <li key={c.afterStep}>
                После шага <strong>{num(c.afterStep)}</strong> — узел на <strong>{c.label}</strong>, новая катушка
                <span className="muted"> (уйдёт ≈ {num(c.usedM)} м)</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
