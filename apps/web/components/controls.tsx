"use client";

import type { ParamSpec, ParamValues } from "@simwilayah/engine";
import { formatIDR, formatNumber } from "@/lib/format";

function Slider({
  spec,
  value,
  onChange,
  accent,
  existing = 0,
}: {
  spec: ParamSpec;
  value: number;
  onChange: (v: number) => void;
  accent: string;
  /** Amount already built — the slider floor; only spend above this is charged. */
  existing?: number;
}) {
  const min = Math.max(spec.min, existing);
  const span = spec.max - min || 1;
  const pct = ((value - min) / span) * 100;
  // existing portion of the track (paid already), drawn lighter
  const exPct =
    spec.max > spec.min
      ? ((existing - spec.min) / (spec.max - spec.min)) * 100
      : 0;
  const added = Math.max(0, value - existing);
  const cost =
    added > 0
      ? added * spec.costPerUnit + (existing <= 0 ? spec.fixedCost : 0)
      : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-medium text-slate-700">
          {spec.label}
        </label>
        <span className="font-mono text-sm font-semibold text-slate-900">
          {formatNumber(value, 1)} {spec.unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={{
          background: `linear-gradient(to right, ${accent} ${pct}%, #e2e8f0 ${pct}%)`,
        }}
      />
      <div className="flex justify-between gap-2 text-xs text-slate-500">
        <span>{spec.description}</span>
        {spec.costPerUnit > 0 && (
          <span className="shrink-0 font-medium text-slate-600">
            {formatIDR(cost)}
          </span>
        )}
      </div>
      {existing > 0 && (
        <div className="text-[10px] text-emerald-600">
          {formatNumber(existing, 1)} {spec.unit} sudah terpasang (gratis) ·
          slider mulai dari sini{" "}
          <span className="text-slate-400">({exPct.toFixed(0)}% skala)</span>
        </div>
      )}
      {spec.authority && (
        <div className="flex flex-wrap items-center gap-1 text-[10px]">
          <span
            className={`rounded px-1.5 py-0.5 font-medium ${SCOPE_META[spec.scope ?? ""]?.cls ?? "bg-slate-100 text-slate-600"}`}
          >
            {spec.authority}
          </span>
          {spec.fundingSource && (
            <span className="text-slate-400">· dana {spec.fundingSource}</span>
          )}
        </div>
      )}
    </div>
  );
}

/** Colour-code a lever by the jurisdiction tier that can fund it. */
export const SCOPE_META: Record<string, { label: string; cls: string }> = {
  pusat: { label: "Pusat / APBN", cls: "bg-rose-100 text-rose-700" },
  provinsi: { label: "Provinsi", cls: "bg-amber-100 text-amber-700" },
  kabupaten: { label: "Kabupaten", cls: "bg-emerald-100 text-emerald-700" },
};

export function ParamGroup({
  title,
  specs,
  values,
  onChange,
  accent,
  existing,
}: {
  title: string;
  specs: ParamSpec[];
  values: ParamValues;
  onChange: (id: string, v: number) => void;
  accent: string;
  /** Per-lever existing amount (floor). Omit for drivers. */
  existing?: ParamValues;
}) {
  return (
    <section className="space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </h3>
      {specs.map((s) => (
        <Slider
          key={s.id}
          spec={s}
          value={values[s.id] ?? 0}
          onChange={(v) => onChange(s.id, v)}
          accent={accent}
          existing={existing?.[s.id] ?? 0}
        />
      ))}
    </section>
  );
}
