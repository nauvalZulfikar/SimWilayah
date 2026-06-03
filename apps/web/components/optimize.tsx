"use client";

import { useState } from "react";
import {
  optimize,
  type SimModel,
  type ParamValues,
  type OptimizeResult,
} from "@simwilayah/engine";
import { formatIDR, formatNumber } from "@/lib/format";

const MILIAR = 1_000_000_000;

// KPIs that make sense as a budgeting objective (both lower-is-better).
const OBJECTIVES = [
  { id: "households_flooded", label: "Rumah terendam", unit: "rumah" },
  {
    id: "households_no_warning",
    label: "Rumah tanpa peringatan",
    unit: "rumah",
  },
] as const;

type ScopeTier = "pusat" | "provinsi" | "kabupaten";

// Cumulative jurisdiction scopes: what each level of coordination unlocks.
const SCOPES: {
  id: string;
  label: string;
  allowed: ScopeTier[];
  cls: string;
}[] = [
  {
    id: "kab",
    label: "DPUTR Kab. saja",
    allowed: ["kabupaten"],
    cls: "text-emerald-700",
  },
  {
    id: "kabprov",
    label: "+ Provinsi (SDA Jabar)",
    allowed: ["kabupaten", "provinsi"],
    cls: "text-amber-700",
  },
  {
    id: "all",
    label: "+ Pusat (BBWS) — semua instansi",
    allowed: ["kabupaten", "provinsi", "pusat"],
    cls: "text-rose-700",
  },
];

/**
 * "Optimasi" — given a budget cap, auto-search the lever space for the package
 * that helps the chosen objective most. The heart of perencanaan + budgeting:
 * the pemda sets the money, the tool finds the best mix. The jurisdiction filter
 * answers the political question: "berapa yang bisa kabupaten kerjakan sendiri,
 * berapa yang butuh provinsi/pusat?".
 */
export function OptimizePanel({
  model,
  drivers,
  onApply,
}: {
  model: SimModel;
  drivers: ParamValues;
  onApply: (levers: ParamValues) => void;
}) {
  const [budgetMiliar, setBudgetMiliar] = useState(300);
  const [objective, setObjective] = useState<string>(OBJECTIVES[0].id);
  const [scopeId, setScopeId] = useState<string>("all");
  // Results keyed by scope id, so we can show the kewenangan breakdown.
  const [results, setResults] = useState<Record<string, OptimizeResult> | null>(
    null,
  );
  const [running, setRunning] = useState(false);

  const objLabel = OBJECTIVES.find((o) => o.id === objective)?.label ?? "";
  const objUnit = OBJECTIVES.find((o) => o.id === objective)?.unit ?? "";

  function run() {
    setRunning(true);
    setResults(null);
    setTimeout(() => {
      const out: Record<string, OptimizeResult> = {};
      for (const s of SCOPES) {
        out[s.id] = optimize(model, drivers, {
          budget: budgetMiliar * MILIAR,
          targetKpiId: objective,
          allowedScopes: s.allowed,
        });
      }
      setResults(out);
      setRunning(false);
    }, 20);
  }

  const result = results?.[scopeId] ?? null;
  const best = result?.best;
  const funded = best
    ? model.levers.filter((l) => (best.levers[l.id] ?? 0) > 0)
    : [];
  const improvement = best?.comparison.improvement ?? 0;
  const improvementPct = best?.comparison.improvementPct ?? 0;
  const leftover = result ? result.budget - best!.cost : 0;

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4">
      <div className="flex items-center gap-2">
        <span className="text-base">🎯</span>
        <h3 className="text-sm font-semibold text-slate-800">
          Optimasi anggaran
        </h3>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        Tentukan batas anggaran — sistem cari kombinasi intervensi terbaik
        secara otomatis (cek semua kemungkinan).
      </p>

      <div className="mt-3 space-y-2">
        <label className="block text-xs font-medium text-slate-600">
          Batas anggaran
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm text-slate-500">Rp</span>
            <input
              type="number"
              min={0}
              step={10}
              value={budgetMiliar}
              onChange={(e) =>
                setBudgetMiliar(Math.max(0, Number(e.target.value)))
              }
              className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums"
            />
            <span className="text-sm text-slate-500">Miliar</span>
          </div>
        </label>

        <label className="block text-xs font-medium text-slate-600">
          Tujuan (minimalkan)
          <select
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {OBJECTIVES.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={run}
          disabled={running}
          className="w-full rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
        >
          {running ? "Menghitung…" : "Cari kombinasi terbaik"}
        </button>
      </div>

      {results && !running && (
        <>
          {/* ---- Kewenangan breakdown: who can solve how much ---- */}
          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs">
            <div className="mb-2 font-semibold text-slate-800">
              Sanggup berapa per kewenangan?
            </div>
            <div className="space-y-1.5">
              {SCOPES.map((s) => {
                const r = results[s.id]!;
                const pct = Math.max(0, r.best.comparison.improvementPct);
                const saved = Math.max(0, r.best.comparison.improvement);
                return (
                  <button
                    key={s.id}
                    onClick={() => setScopeId(s.id)}
                    className={`block w-full rounded-md border px-2 py-1.5 text-left transition ${
                      scopeId === s.id
                        ? "border-sky-500 bg-sky-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-medium ${s.cls}`}>{s.label}</span>
                      <span className="tabular-nums font-semibold text-slate-800">
                        {formatNumber(pct, 0)}%
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-sky-500"
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-500">
                      {formatNumber(saved)} {objUnit} · {formatIDR(r.best.cost)}
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
              Senjata rapat koordinasi: tunjukkan porsi yang bisa dituntaskan
              kabupaten sendiri vs yang harus menunggu anggaran provinsi/pusat.
            </p>
          </div>

          {/* ---- Selected package detail ---- */}
          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs">
            {improvement <= 0 ? (
              <p className="text-slate-600">
                Dengan anggaran <b>{formatIDR(result!.budget)}</b> pada cakupan{" "}
                <b>{SCOPES.find((s) => s.id === scopeId)?.label}</b> belum ada
                paket yang mengurangi <b>{objLabel.toLowerCase()}</b>. Naikkan
                anggaran atau perluas kewenangan.
              </p>
            ) : (
              <>
                <div className="mb-2 font-semibold text-slate-800">
                  Paket terpilih ·{" "}
                  <span className="font-normal text-slate-500">
                    {SCOPES.find((s) => s.id === scopeId)?.label}
                  </span>
                </div>
                <ul className="space-y-1">
                  {funded.map((l) => (
                    <li key={l.id} className="flex justify-between gap-2">
                      <span className="text-slate-600">
                        {l.label}
                        {l.fundingSource && (
                          <span className="text-slate-400">
                            {" "}
                            ({l.fundingSource})
                          </span>
                        )}
                      </span>
                      <span className="font-medium tabular-nums text-slate-900">
                        {formatNumber(best!.levers[l.id]!, 1)} {l.unit}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                  <Row label="Biaya paket" value={formatIDR(best!.cost)} />
                  <Row
                    label="Sisa anggaran"
                    value={formatIDR(Math.max(0, leftover))}
                    muted
                  />
                  <Row
                    label={objLabel}
                    value={`${formatNumber(result!.baselineKpi)} → ${formatNumber(
                      best!.kpi,
                    )} ${objUnit}`}
                  />
                  <Row
                    label="Terselamatkan"
                    value={`${formatNumber(improvement)} ${objUnit} (${formatNumber(
                      improvementPct,
                      0,
                    )}%)`}
                    good
                  />
                  <Row
                    label="Biaya / unit"
                    value={
                      Number.isFinite(best!.comparison.costPerUnitImprovement)
                        ? `${formatIDR(best!.comparison.costPerUnitImprovement)} / ${objUnit}`
                        : "—"
                    }
                    muted
                  />
                </div>

                <button
                  onClick={() => onApply(best!.levers)}
                  className="mt-3 w-full rounded-lg border border-sky-600 px-3 py-1.5 text-sm font-semibold text-sky-700 transition hover:bg-sky-600 hover:text-white"
                >
                  Terapkan ke slider
                </button>
              </>
            )}
            <p className="mt-2 text-[10px] text-slate-400">
              Dicek {formatNumber(result!.evaluated)} kombinasi
              {result!.truncated ? " (terpotong batas aman)" : ""}.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  good,
  muted,
}: {
  label: string;
  value: string;
  good?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span
        className={`font-medium tabular-nums ${
          good
            ? "text-emerald-600"
            : muted
              ? "text-slate-400"
              : "text-slate-800"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
