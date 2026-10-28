// Константы: буквы секторов и число гвоздей
import { SECTORS, TOTAL_NAILS } from "@/lib/constants";
// Метка гвоздя («C37») и его координаты на круге
import { nailLabel, nailXY } from "@/lib/nails";

/**
 * Номер гвоздя с маленьким «компасом»: круг, оси и точка там, где гвоздь на доске.
 * Сектор понятен с одного взгляда, даже если буква не успела прочитаться.
 */
// Компонент: номер гвоздя + мини-схема, где он находится
export function NailBadge({ nail, className }: { nail: number; className?: string }) {
  // Координаты гвоздя на мини-круге радиусом 9 с центром (12, 12) — в системе координат иконки 24×24
  const [x, y] = nailXY(nail, 9, 12, 12);
  // Номер сектора 0..3 (по 60 гвоздей)
  const sector = Math.floor(nail / (TOTAL_NAILS / SECTORS.length));
  // Четверть круга сектора: A — слева сверху, дальше по часовой
  // SVG-контуры четвертей круга для A, B, C, D; берём нужную
  const quarter = ["M12 12V3A9 9 0 0 0 3 12Z", "M12 12V3a9 9 0 0 1 9 9Z", "M12 12h9a9 9 0 0 1-9 9Z", "M12 12v9a9 9 0 0 1-9-9Z"][sector];
  // Разметка
  return (
    // Обёртка; дополнительный класс — от родителя
    <span className={`nail ${className ?? ""}`}>
      {/* Мини-схема; aria-hidden — экранный диктор её не читает (он прочитает текст метки) */}
      <svg className="nail-compass" viewBox="0 0 24 24" aria-hidden="true">
        {/* Контур круга */}
        <circle cx="12" cy="12" r="9" className="nc-ring" />
        {/* Подсвеченная четверть сектора */}
        <path d={quarter} className="nc-quarter" />
        {/* Оси X и Y */}
        <path d="M3 12h18M12 3v18" className="nc-axis" />
        {/* Точка гвоздя (toFixed — чтобы сервер и браузер дали одинаковые числа) */}
        <circle cx={x.toFixed(2)} cy={y.toFixed(2)} r="2.4" className="nc-dot" />
      </svg>
      {/* Текст метки, например «C37» */}
      {nailLabel(nail)}
    </span>
  );
}
