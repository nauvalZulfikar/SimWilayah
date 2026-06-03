"use client";

import type {
  Comparison,
  Kpi,
  RankedScenario,
  SimModel,
  SimResult,
} from "@simwilayah/engine";
import { formatCostPer, formatIDR, formatNumber } from "@/lib/format";
import type { PresetScenario, RainScenario } from "@simwilayah/engine";

export function PresetBar({
  presets,
  activeId,
  onPick,
}: {
  presets: PresetScenario[];
  activeId: string | null;
  onPick: (p: PresetScenario) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {presets.map((p) => (
        <button
          key={p.id}
          onClick={() => onPick(p)}
          title={p.summary}
          className={`rounded-full border px-3 py-1.5 text-sm transition ${
            activeId === p.id
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
          }`}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}

/** Scenario KPIs with their delta vs the do-nothing baseline. */
export function KpiCards({
  scenario,
  baseline,
}: {
  scenario: SimResult;
  baseline: SimResult;
}) {
  const baseById = new Map(baseline.kpis.map((k) => [k.id, k.value]));
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {scenario.kpis.map((k) => {
        const base = baseById.get(k.id) ?? k.value;
        const delta = k.value - base;
        const improved = k.betterWhenLower ? delta < 0 : delta > 0;
        const worse = k.betterWhenLower ? delta > 0 : delta < 0;
        return (
          <div
            key={k.id}
            className="rounded-xl border border-slate-200 bg-white p-4"
          >
            <div className="text-xs text-slate-500">{k.label}</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">
              {formatNumber(
                k.value,
                k.unit === "m" ? 2 : k.unit === "ha" ? 1 : 0,
              )}
              <span className="ml-1 text-sm font-normal text-slate-400">
                {k.unit}
              </span>
            </div>
            {Math.abs(delta) > 1e-6 && (
              <div
                className={`mt-1 text-xs font-medium ${improved ? "text-green-600" : worse ? "text-red-600" : "text-slate-500"}`}
              >
                {delta > 0 ? "▲" : "▼"}{" "}
                {formatNumber(
                  Math.abs(delta),
                  k.unit === "m" ? 2 : k.unit === "ha" ? 1 : 0,
                )}{" "}
                vs baseline
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function CostEffectivenessCard({
  comparison,
}: {
  comparison: Comparison;
}) {
  const c = comparison;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-slate-800">
        Efektivitas Biaya
      </h3>
      <dl className="mt-3 space-y-2 text-sm">
        <Row label="Total biaya intervensi" value={formatIDR(c.cost)} />
        <Row
          label={`Pengurangan ${c.primaryKpi.label.toLowerCase()}`}
          value={`${formatNumber(c.improvement, 0)} ${c.primaryKpi.unit} (${c.improvementPct.toFixed(0)}%)`}
          accent="text-green-600"
        />
        <Row
          label="Biaya per rumah terselamatkan"
          value={formatCostPer(c.costPerUnitImprovement, "rumah")}
        />
      </dl>
    </div>
  );
}

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`font-semibold ${accent ?? "text-slate-900"}`}>{value}</dd>
    </div>
  );
}

/** Ranked candidate packages — cheapest IDR per household saved first. */
export function RankingTable({ ranked }: { ranked: RankedScenario[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-4 py-2">#</th>
            <th className="px-4 py-2">Paket solusi</th>
            <th className="px-4 py-2 text-right">Rumah selamat</th>
            <th className="px-4 py-2 text-right">Biaya</th>
            <th className="px-4 py-2 text-right">Rp / rumah</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((r, i) => (
            <tr
              key={r.name}
              className={
                i === 0 ? "bg-green-50/60" : "border-t border-slate-100"
              }
            >
              <td className="px-4 py-2 text-slate-400">{i + 1}</td>
              <td className="px-4 py-2 font-medium text-slate-800">
                {r.name}
                {i === 0 && (
                  <span className="ml-2 rounded bg-green-600 px-1.5 py-0.5 text-[10px] text-white">
                    TERBAIK
                  </span>
                )}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                {formatNumber(r.comparison.improvement, 0)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                {formatIDR(r.comparison.cost)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                {Number.isFinite(r.comparison.costPerUnitImprovement)
                  ? formatIDR(r.comparison.costPerUnitImprovement)
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
        Diurutkan dari biaya termurah per rumah terselamatkan (paling efisien di
        atas).
      </p>
    </div>
  );
}

/**
 * Return-period rain selector. One click loads a coherent design storm (rainfall
 * + duration + upstream rise) so the user stress-tests the package against an
 * Q2 / Q5 / Q25 / extreme event instead of nudging three sliders by hand.
 */
export function RainScenarioBar({
  scenarios,
  activeId,
  onPick,
}: {
  scenarios: RainScenario[];
  activeId: string | null;
  onPick: (s: RainScenario) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {scenarios.map((s) => (
        <button
          key={s.id}
          onClick={() => onPick(s)}
          title={s.summary}
          className={`rounded-full border px-3 py-1.5 text-sm transition ${
            activeId === s.id
              ? "border-sky-600 bg-sky-600 text-white"
              : "border-slate-300 bg-white text-slate-700 hover:border-sky-400"
          }`}
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}

/**
 * Early-warning readout (operasional). For the current scenario it lists which
 * zones are in warning/critical and how many households would be caught WITHOUT
 * a warning — the action sheet a BPBD/EWS operator reads when rain comes in.
 */
export function WarningPanel({
  model,
  scenario,
}: {
  model: SimModel;
  scenario: SimResult;
}) {
  const nameById = new Map(model.zones.map((z) => [z.id, z.name]));
  const alerts = scenario.zones
    .filter((z) => z.status !== "ok")
    .sort((a, b) => b.severity - a.severity);
  const noWarning =
    scenario.kpis.find((k) => k.id === "households_no_warning")?.value ?? 0;
  const flooded =
    scenario.kpis.find((k) => k.id === "households_flooded")?.value ?? 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-base">🚨</span>
        <h2 className="text-sm font-semibold text-slate-800">
          Peringatan dini (skenario saat ini)
        </h2>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Jika hujan ini terjadi:{" "}
        <b className="text-slate-700">{formatNumber(flooded)}</b> rumah
        terendam, <b className="text-red-600">{formatNumber(noWarning)}</b>{" "}
        berisiko tanpa peringatan. Tingkatkan lever EWS untuk menurunkannya.
      </p>
      {alerts.length === 0 ? (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-700">
          Tidak ada zona berstatus waspada/kritis pada skenario ini.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {alerts.map((z) => {
            const crit = z.status === "critical";
            return (
              <li
                key={z.zoneId}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${crit ? "bg-red-500" : "bg-amber-400"}`}
                  />
                  <span className="font-medium text-slate-800">
                    {nameById.get(z.zoneId) ?? z.zoneId}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums text-slate-500">
                    {z.severity.toFixed(2)} m
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${crit ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}
                  >
                    {crit ? "EVAKUASI" : "SIAGA"}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
