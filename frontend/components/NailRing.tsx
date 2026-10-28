// Буквы секторов и число гвоздей
import { SECTORS, TOTAL_NAILS } from "@/lib/constants";
// Координаты гвоздя и угол середины сектора
import { nailXY, sectorCenterAngle } from "@/lib/nails";

// Округляем координаты: Math.sin на сервере и в браузере может расходиться в последнем бите,
// и React ругается на несовпадение атрибутов при гидратации.
// Округление до сотых
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Декоративное кольцо из 240 гвоздей с подписями секторов — мотив всего приложения. */
// Компонент кольца
export function NailRing({ className }: { className?: string }) {
  // Размер системы координат SVG
  const size = 400;
  // Центр
  const c = size / 2;
  // Радиус кольца гвоздей
  const r = 168;
  // Разметка
  return (
    // Векторная картинка; декоративная — скрыта от экранного диктора
    <svg className={className} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {/* Горизонтальная ось */}
      <line x1={c - r} y1={c} x2={c + r} y2={c} className="ring-axis" />
      {/* Вертикальная ось */}
      <line x1={c} y1={c - r} x2={c} y2={c + r} className="ring-axis" />
      {/* 240 точек-гвоздей: Array.from создаёт массив нужной длины */}
      {Array.from({ length: TOTAL_NAILS }, (_, i) => {
        // Координаты гвоздя
        const [x, y] = nailXY(i, r, c, c);
        // Каждый десятый и последний в секторе — крупнее (так проще считать)
        const major = i % 10 === 0 || i % 60 === 59;
        // Точка; key — уникальный ключ элемента списка для React
        return <circle key={i} cx={r2(x)} cy={r2(y)} r={major ? 2.1 : 1.3} className="ring-nail" />;
      })}
      {/* Буквы секторов снаружи кольца */}
      {SECTORS.map((s, i) => {
        // Угол середины сектора
        const a = sectorCenterAngle(i);
        // Чуть дальше кольца
        const rr = r + 20;
        // Подпись
        return (
          // Текст в точке на окружности радиуса rr
          <text key={s} x={r2(c + rr * Math.sin(a))} y={r2(c - rr * Math.cos(a))} className="ring-sector">
            {/* Буква сектора */}
            {s}
          </text>
        );
      })}
    </svg>
  );
}
