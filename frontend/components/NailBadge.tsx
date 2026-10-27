import { SECTORS, TOTAL_NAILS } from "@/lib/constants";
import { nailLabel, nailXY } from "@/lib/nails";

/**
 * Номер гвоздя с маленьким «компасом»: круг, оси и точка там, где гвоздь на доске.
 * Сектор понятен с одного взгляда, даже если буква не успела прочитаться.
 */
export function NailBadge({ nail, className }: { nail: number; className?: string }) {
  const [x, y] = nailXY(nail, 9, 12, 12);
  const sector = Math.floor(nail / (TOTAL_NAILS / SECTORS.length));
  // Четверть круга сектора: A — слева сверху, дальше по часовой
  const quarter = ["M12 12V3A9 9 0 0 0 3 12Z", "M12 12V3a9 9 0 0 1 9 9Z", "M12 12h9a9 9 0 0 1-9 9Z", "M12 12v9a9 9 0 0 1-9-9Z"][sector];
  return (
    <span className={`nail ${className ?? ""}`}>
      <svg className="nail-compass" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" className="nc-ring" />
        <path d={quarter} className="nc-quarter" />
        <path d="M3 12h18M12 3v18" className="nc-axis" />
        <circle cx={x.toFixed(2)} cy={y.toFixed(2)} r="2.4" className="nc-dot" />
      </svg>
      {nailLabel(nail)}
    </span>
  );
}
