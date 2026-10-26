// Зеркало backend/app/config.py. Совпадение проверяет контрактный тест (e2e/api.contract.spec.ts).

export const SECTORS = ["A", "B", "C", "D"] as const;
export type Sector = (typeof SECTORS)[number];
export const NAILS_PER_SECTOR = 60;
export const TOTAL_NAILS = NAILS_PER_SECTOR * SECTORS.length; // 240

export const MIN_LINES = 1000;
export const MAX_LINES = 5000;
export const LINES_PER_CM = 40;

export const DIAMETER_PRESETS_CM = [30, 40, 50, 60, 70] as const;
export const DEFAULT_DIAMETER_CM = 50;
export const MIN_DIAMETER_CM = 20;
export const MAX_DIAMETER_CM = 150;

export const THREAD_DIAMETER_MM = 0.2;
export const THREAD_MARGIN = 0.15;
export const STANDARD_SPOOLS_M = [100, 150, 200, 300, 500, 1000, 1500, 2000, 3000, 5000] as const;
export const BIG_SPOOL_M = 1000;

export const DEFAULT_SPEED_SEC = 2.0;
export const SPEED_STEP_SEC = 0.1;
export const MIN_SPEED_SEC = 0.5;
export const MAX_SPEED_SEC = 10.0;
