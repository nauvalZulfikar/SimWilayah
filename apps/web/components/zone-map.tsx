"use client";

import type { SimModel, ZoneOutcome } from "@simwilayah/engine";

const STATUS_RING: Record<string, string> = {
  ok: "#16a34a",
  warning: "#d97706",
  critical: "#dc2626",
};

/** Interpolate slate-100 → blue-900 by flood depth (0..1.5 m). */
function depthFill(depth: number): string {
  const t = Math.min(Math.max(depth, 0) / 1.5, 1);
  const from = [241, 245, 249];
  const to = [30, 58, 138];
  const c = from.map((v, i) => Math.round(v + (to[i]! - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function ZoneMap({
  model,
  zones,
  selectedZoneId,
  onSelectZone,
}: {
  model: SimModel;
  zones: ZoneOutcome[];
  selectedZoneId?: string | null;
  onSelectZone?: (id: string) => void;
}) {
  const byId = new Map(zones.map((z) => [z.zoneId, z]));

  return (
    <svg
      viewBox="0 0 100 100"
      className="w-full h-auto rounded-xl bg-gradient-to-b from-emerald-50 to-sky-50"
    >
      {/* Tributaries + Citarum */}
      <path
        d="M14 24 Q34 50 50 80"
        fill="none"
        stroke="#7dd3fc"
        strokeWidth={1.6}
        opacity={0.8}
      />
      <path
        d="M82 30 Q66 54 50 80"
        fill="none"
        stroke="#7dd3fc"
        strokeWidth={1.6}
        opacity={0.8}
      />
      <path
        d="M0 86 Q50 94 100 84"
        fill="none"
        stroke="#38bdf8"
        strokeWidth={4}
        opacity={0.85}
        strokeLinecap="round"
      />
      <text x="6" y="22" fontSize={2.4} fill="#0369a1">
        Cikeruh
      </text>
      <text x="84" y="28" fontSize={2.4} fill="#0369a1">
        Citarik
      </text>
      <text x="3" y="91" fontSize={2.6} fill="#0369a1" fontWeight={600}>
        Sungai Citarum →
      </text>

      {model.zones.map((z) => {
        const o = byId.get(z.id);
        const depth = o?.severity ?? 0;
        const status = o?.status ?? "ok";
        const households = z.attrs.households ?? 0;
        const r = 4.5 + (households / 4200) * 3.8;
        const selected = selectedZoneId === z.id;
        return (
          <g
            key={z.id}
            onClick={() => onSelectZone?.(z.id)}
            className={onSelectZone ? "cursor-pointer" : undefined}
          >
            <circle
              cx={z.x}
              cy={z.y}
              r={r}
              fill={depthFill(depth)}
              stroke={selected ? "#0f172a" : STATUS_RING[status]}
              strokeWidth={selected ? 1.4 : 0.9}
            />
            <text
              x={z.x}
              y={z.y + 0.9}
              fontSize={2.3}
              textAnchor="middle"
              fill={depth > 0.6 ? "#fff" : "#0f172a"}
              fontWeight={600}
            >
              {depth >= 0.05 ? `${depth.toFixed(2)}m` : "—"}
            </text>
            <text
              x={z.x}
              y={z.y - r - 0.8}
              fontSize={2.1}
              textAnchor="middle"
              fill="#334155"
            >
              {z.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function MapLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
      <span className="flex items-center gap-1">
        <span className="inline-block h-3 w-6 rounded bg-gradient-to-r from-slate-100 to-blue-900" />
        Kedalaman 0 → 1,5 m
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-full ring-2 ring-green-600" />{" "}
        Aman
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-full ring-2 ring-amber-600" />{" "}
        Waspada
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-full ring-2 ring-red-600" />{" "}
        Kritis
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-1 w-6 rounded bg-sky-400" /> Sungai
        utama
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-0.5 w-6 rounded bg-sky-300" /> Anak
        sungai
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-0.5 w-6 rounded bg-yellow-300" /> Batas
        Kab. Bandung
      </span>
    </div>
  );
}
