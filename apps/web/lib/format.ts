const TRILIUN = 1_000_000_000_000;
const MILIAR = 1_000_000_000;
const JUTA = 1_000_000;

/** Compact IDR for dashboards: "Rp 1,2 T", "Rp 340 M", "Rp 50 jt". */
export function formatIDR(n: number): string {
  if (n <= 0) return "Rp 0";
  if (n >= TRILIUN) return `Rp ${trim(n / TRILIUN)} T`;
  if (n >= MILIAR) return `Rp ${trim(n / MILIAR)} M`;
  if (n >= JUTA) return `Rp ${trim(n / JUTA)} jt`;
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

function trim(x: number): string {
  return x.toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

export function formatNumber(n: number, dp = 0): string {
  return n.toLocaleString("id-ID", { maximumFractionDigits: dp });
}

/** IDR per household saved → "Rp 12 jt / rumah". */
export function formatCostPer(n: number, unit: string): string {
  if (!Number.isFinite(n)) return "—";
  return `${formatIDR(n)} / ${unit}`;
}
