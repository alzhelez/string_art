import { SECTORS, TOTAL_NAILS } from "@/lib/constants";
import { nailXY, sectorCenterAngle } from "@/lib/nails";

// Округляем координаты: Math.sin на сервере и в браузере может расходиться в последнем бите,
// и React ругается на несовпадение атрибутов при гидратации.
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Декоративное кольцо из 240 гвоздей с подписями секторов — мотив всего приложения. */
export function NailRing({ className }: { className?: string }) {
  const size = 400;
  const c = size / 2;
  const r = 168;
  return (
    <svg className={className} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <line x1={c - r} y1={c} x2={c + r} y2={c} className="ring-axis" />
      <line x1={c} y1={c - r} x2={c} y2={c + r} className="ring-axis" />
      {Array.from({ length: TOTAL_NAILS }, (_, i) => {
        const [x, y] = nailXY(i, r, c, c);
        const major = i % 10 === 0 || i % 60 === 59;
        return <circle key={i} cx={r2(x)} cy={r2(y)} r={major ? 2.1 : 1.3} className="ring-nail" />;
      })}
      {SECTORS.map((s, i) => {
        const a = sectorCenterAngle(i);
        const rr = r + 20;
        return (
          <text key={s} x={r2(c + rr * Math.sin(a))} y={r2(c - rr * Math.cos(a))} className="ring-sector">
            {s}
          </text>
        );
      })}
    </svg>
  );
}
