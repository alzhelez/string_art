"use client";

import { useEffect, useState } from "react";
import { DIAMETER_PRESETS_CM, MAX_DIAMETER_CM, MIN_DIAMETER_CM } from "@/lib/constants";

interface Props {
  value: number;
  onChange: (cm: number) => void;
  id?: string;
}

/** Пресеты 30–70 см и своё значение. Невалидный ввод не уходит наружу. */
export function DiameterPicker({ value, onChange, id = "diameter" }: Props) {
  const isPreset = (DIAMETER_PRESETS_CM as readonly number[]).includes(value);
  const [custom, setCustom] = useState(isPreset ? "" : String(value));
  const [error, setError] = useState("");

  useEffect(() => {
    if ((DIAMETER_PRESETS_CM as readonly number[]).includes(value)) setCustom("");
  }, [value]);

  const commitCustom = (raw: string) => {
    setCustom(raw);
    if (raw.trim() === "") {
      setError("");
      return;
    }
    const n = Number(raw.replace(",", "."));
    if (!Number.isFinite(n) || n < MIN_DIAMETER_CM || n > MAX_DIAMETER_CM) {
      setError(`Диаметр от ${MIN_DIAMETER_CM} до ${MAX_DIAMETER_CM} см`);
      return;
    }
    setError("");
    onChange(Math.round(n * 10) / 10);
  };

  return (
    <fieldset className="diameter">
      <legend>Диаметр круга</legend>
      <div className="segmented" role="radiogroup" aria-label="Диаметр круга">
        {DIAMETER_PRESETS_CM.map((cm) => (
          <button
            key={cm}
            type="button"
            role="radio"
            aria-checked={value === cm && custom === ""}
            className="seg"
            onClick={() => {
              setCustom("");
              setError("");
              onChange(cm);
            }}
          >
            {cm}
          </button>
        ))}
        <label className="seg-custom">
          <input
            id={id}
            type="text"
            inputMode="decimal"
            placeholder="своё"
            aria-label="Свой диаметр, см"
            aria-invalid={error !== ""}
            value={custom}
            onChange={(e) => commitCustom(e.target.value)}
          />
          <span>см</span>
        </label>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
