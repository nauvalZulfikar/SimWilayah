"use client";

import type { TimeStep } from "@simwilayah/engine";

function linePath(values: number[], w: number, h: number, pad = 4): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = (w - pad * 2) / Math.max(1, values.length - 1);
  return values
    .map((v, i) => {
      const x = pad + i * stepX;
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Dual-line timeline: river surface (left) and peak flood depth (right). */
export function TimelineChart({ timeline }: { timeline: TimeStep[] }) {
  const w = 320;
  const h = 120;
  const river = timeline.map((t) => t.series.river_level_m ?? 0);
  const depth = timeline.map((t) => t.series.max_depth_m ?? 0);

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
        <rect x={0} y={0} width={w} height={h} fill="#f8fafc" rx={8} />
        <path d={linePath(river, w, h)} fill="none" stroke="#0ea5e9" strokeWidth={2} />
        <path d={linePath(depth, w, h)} fill="none" stroke="#1e3a8a" strokeWidth={2} strokeDasharray="4 3" />
      </svg>
      <div className="mt-1 flex gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-sky-500" /> Muka air Citarum
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-blue-900" /> Kedalaman puncak
        </span>
        <span className="ml-auto text-slate-400">jam ke- →</span>
      </div>
    </div>
  );
}
