// Цвета для canvas (CSS-переменные в canvas не попадают). Те же значения — в globals.css.
export const PALETTE = {
  board: "#ffffff", // белый круг, на котором натянута леска
  line: "#000000", // чёрная леска
  graphite: "#23272e",
  steel: "#7d8a97", // гвозди
  chalk: "#2457d6", // синяя отбивочная нить — «текущая линия»
  chalkSoft: "rgba(36, 87, 214, 0.14)",
} as const;
