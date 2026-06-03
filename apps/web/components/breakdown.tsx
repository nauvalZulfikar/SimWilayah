"use client";

import { useState } from "react";
import {
  budgetFrontier,
  type SimModel,
  type ParamValues,
  type ZoneOutcome,
  type FrontierPoint,
} from "@simwilayah/engine";
import { formatIDR, formatNumber } from "@/lib/format";

const MILIAR = 1_000_000_000;

const STATUS_META: Record<string, { label: string; cls: string }> = {
  ok: { label: "Aman", cls: "bg-emerald-100 text-emerald-700" },
  warning: { label: "Waspada", cls: "bg-amber-100 text-amber-700" },
  critical: { label: "Kritis", cls: "bg-red-100 text-red-700" },
};

function depthText(d: number) {
  return d >= 0.05 ? `${d.toFixed(2)} m` : "—";
}

/**
 * Per-zone impact — the "akibat" expanded, now with the before→after delta and
 * the homes saved / budget attributed to each kampung. Shows exactly how the 4
 * headline KPIs are built up and which zones each rupiah actually helps.
 */
export function ZoneImpactTable({
  model,
  zones,
  baselineZones,
  costPerHomeSaved,
}: {
  model: SimModel;
  zones: ZoneOutcome[];
  baselineZones: ZoneOutcome[];
  /** IDR per household saved for the current package (Infinity if none saved). */
  costPerHomeSaved: number;
}) {
  const nameById = new Map(model.zones.map((z) => [z.id, z.name]));
  const observedById = new Map(
    model.zones.map((z) => [z.id, (z.attrs.flooded_observed ?? 0) > 0]),
  );
  const baseById = new Map(baselineZones.map((z) => [z.zoneId, z]));

  const rows = zones
    .map((z) => {
      const base = baseById.get(z.zoneId);
      const before = base?.severity ?? z.severity;
      const wasFlooded = (base?.status ?? "ok") !== "ok";
      const nowFlooded = z.status !== "ok";
      const households = z.detail.households ?? 0;
      const saved = wasFlooded && !nowFlooded ? households : 0;
      const allocCost =
        saved > 0 && Number.isFinite(costPerHomeSaved)
          ? saved * costPerHomeSaved
          : 0;
      return {
        z,
        before,
        after: z.severity,
        households,
        saved,
        allocCost,
        nowFlooded,
      };
    })
    .sort((a, b) => b.before - a.before);

  const homesFloodedNow = rows.reduce(
    (s, r) => s + (r.nowFlooded ? r.households : 0),
    0,
  );
  const floodedCount = rows.filter((r) => r.nowFlooded).length;
  const savedTotal = rows.reduce((s, r) => s + r.saved, 0);

  // Calibration check: of the zones that flooded in the real 2025 event, how
  // many does the model also flood at the do-nothing baseline?
  const observedIds = model.zones
    .filter((z) => (z.attrs.flooded_observed ?? 0) > 0)
    .map((z) => z.id);
  const observedHit = observedIds.filter(
    (id) => (baseById.get(id)?.status ?? "ok") !== "ok",
  ).length;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="mb-1 text-sm font-semibold text-slate-800">
        Rincian akibat per zona
      </h2>
      <p className="mb-3 text-xs text-slate-500">
        <b className="text-slate-700">{floodedCount}</b> dari {rows.length} zona
        tergenang →{" "}
        <b className="text-slate-700">{formatNumber(homesFloodedNow)}</b> rumah
        terendam
        {savedTotal > 0 && (
          <>
            {" "}
            <span className="text-emerald-600">
              (▼ {formatNumber(savedTotal)} selamat vs baseline)
            </span>
          </>
        )}
        . Tergenang = kedalaman ≥ 0,1 m.
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-100">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2">Zona</th>
              <th className="px-3 py-2 text-right">Rumah</th>
              <th className="px-3 py-2 text-right">Sebelum</th>
              <th className="px-3 py-2 text-right">Sesudah</th>
              <th className="px-3 py-2 text-right">Selamat</th>
              <th className="px-3 py-2 text-right">Alokasi biaya</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const m = STATUS_META[r.z.status]!;
              return (
                <tr key={r.z.zoneId} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {nameById.get(r.z.zoneId) ?? r.z.zoneId}
                    {observedById.get(r.z.zoneId) && (
                      <span
                        title="Tercatat banjir pada kejadian nyata (Nov 2025) — cek kalibrasi"
                        className="ml-1.5 rounded bg-sky-100 px-1 py-0.5 text-[9px] font-semibold text-sky-700"
                      >
                        2025
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {formatNumber(r.households)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                    {depthText(r.before)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="tabular-nums font-medium text-slate-900">
                      {depthText(r.after)}
                    </span>{" "}
                    <span
                      className={`rounded px-1 py-0.5 text-[10px] font-medium ${m.cls}`}
                    >
                      {m.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-600">
                    {r.saved > 0 ? formatNumber(r.saved) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                    {r.allocCost > 0 ? formatIDR(r.allocCost) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-slate-400">
        “Selamat” = rumah yang tadinya terendam kini aman. “Alokasi biaya” =
        biaya paket dibebankan ke tiap zona sebanding rumah yang diselamatkan.
      </p>
      {observedIds.length > 0 && (
        <p className="mt-1 text-[10px] text-sky-600">
          <span className="rounded bg-sky-100 px-1 py-0.5 font-semibold">
            2025
          </span>{" "}
          = tercatat banjir nyata. Validasi: model ikut menggenangi{" "}
          <b>
            {observedHit}/{observedIds.length}
          </b>{" "}
          zona tsb pada baseline.
        </p>
      )}
    </div>
  );
}

/**
 * Financial breakdown (mini-RAB) — turns the single "Total anggaran" figure into
 * line items: each funded intervention's volume × unit cost + mobilisation, with
 * a grand total. This IS "paket yang didapatkan" with its money attached.
 */
export function CostBreakdown({
  model,
  levers,
}: {
  model: SimModel;
  levers: ParamValues;
}) {
  // Only spend ABOVE existing is charged; fixed cost only when built from scratch.
  const items = model.levers
    .map((l) => {
      const ex = model.existing?.[l.id] ?? 0;
      const qty = levers[l.id] ?? 0;
      const added = qty - ex;
      if (added <= 1e-9) return null;
      const variable = added * l.costPerUnit;
      const fixed = ex <= 0 ? l.fixedCost : 0;
      return { l, added, ex, qty, variable, fixed, subtotal: variable + fixed };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const existingList = model.levers
    .map((l) => ({ l, ex: model.existing?.[l.id] ?? 0 }))
    .filter((x) => x.ex > 0);

  const total = items.reduce((s, it) => s + it.subtotal, 0);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="mb-1 text-sm font-semibold text-slate-800">
        Rincian biaya &amp; paket
      </h2>
      <p className="mb-3 text-xs text-slate-500">
        Biaya hanya untuk pembangunan <b>di atas yang sudah ada</b> (volume baru
        × biaya satuan + biaya tetap).
      </p>

      {existingList.length > 0 && (
        <div className="mb-3 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 text-xs">
          <div className="mb-1 font-semibold text-emerald-800">
            Sudah terpasang (eksisting · Rp 0 biaya baru)
          </div>
          <ul className="space-y-0.5">
            {existingList.map(({ l, ex }) => (
              <li
                key={l.id}
                className="flex justify-between gap-2 text-slate-600"
              >
                <span>{l.label}</span>
                <span className="tabular-nums font-medium text-emerald-700">
                  {formatNumber(ex, 1)} {l.unit}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-400">
          Belum ada intervensi didanai — total <b>Rp 0</b>. Geser lever atau
          pakai 🎯 Optimasi.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-100">
          <table className="w-full min-w-[460px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2">Intervensi</th>
                <th className="px-3 py-2 text-right">Volume baru</th>
                <th className="px-3 py-2 text-right">Biaya satuan</th>
                <th className="px-3 py-2 text-right">Tetap</th>
                <th className="px-3 py-2 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr
                  key={it.l.id}
                  className="border-t border-slate-100 align-top"
                >
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {it.l.label}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    +{formatNumber(it.added, 1)} {it.l.unit}
                    {it.ex > 0 && (
                      <span className="text-slate-400">
                        {" "}
                        (total {formatNumber(it.qty, 1)})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {formatIDR(it.l.costPerUnit)}
                    <span className="text-slate-400">/{it.l.unit}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                    {it.fixed > 0 ? formatIDR(it.fixed) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">
                    {formatIDR(it.subtotal)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50">
                <td
                  className="px-3 py-2 font-semibold text-slate-700"
                  colSpan={4}
                >
                  Total anggaran
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-base font-bold text-slate-900">
                  {formatIDR(total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Budget → homes-saved curve. Calls the engine's budgetFrontier across a sweep
 * of budgets and plots the diminishing-returns curve, marking the budget at
 * which dredging (the lever that finally reaches the non-eligible zones) first
 * becomes worth funding.
 */
export function BudgetCurve({
  model,
  drivers,
}: {
  model: SimModel;
  drivers: ParamValues;
}) {
  const [maxMiliar, setMaxMiliar] = useState(1200);
  const [points, setPoints] = useState<FrontierPoint[] | null>(null);
  const [running, setRunning] = useState(false);

  function run() {
    setRunning(true);
    setPoints(null);
    setTimeout(() => {
      const f = budgetFrontier(model, drivers, {
        maxBudget: maxMiliar * MILIAR,
        steps: 24,
      });
      setPoints(f);
      setRunning(false);
    }, 20);
  }

  const W = 360;
  const H = 170;
  const padL = 8;
  const padR = 8;
  const padT = 10;
  const padB = 8;

  let svg: React.ReactNode = null;
  let caption: React.ReactNode = null;
  if (points && points.length > 1) {
    const maxBudget = points[points.length - 1]!.budget || 1;
    const maxSaved = Math.max(1, ...points.map((p) => p.saved));
    const x = (b: number) => padL + (b / maxBudget) * (W - padL - padR);
    const y = (s: number) => H - padB - (s / maxSaved) * (H - padT - padB);
    const path = points
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"}${x(p.budget).toFixed(1)},${y(p.saved).toFixed(1)}`,
      )
      .join(" ");
    const area = `${path} L${x(maxBudget).toFixed(1)},${(H - padB).toFixed(1)} L${x(0).toFixed(1)},${(H - padB).toFixed(1)} Z`;
    const dredgeIdx = points.findIndex((p) => (p.levers.dredge ?? 0) > 0);
    const dredgePt = dredgeIdx >= 0 ? points[dredgeIdx]! : null;
    const last = points[points.length - 1]!;

    svg = (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        <rect x={0} y={0} width={W} height={H} fill="#f8fafc" rx={8} />
        <path d={area} fill="#bae6fd" opacity={0.5} />
        <path d={path} fill="none" stroke="#0284c7" strokeWidth={2} />
        {dredgePt && (
          <g>
            <line
              x1={x(dredgePt.budget)}
              y1={padT}
              x2={x(dredgePt.budget)}
              y2={H - padB}
              stroke="#dc2626"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle
              cx={x(dredgePt.budget)}
              cy={y(dredgePt.saved)}
              r={3}
              fill="#dc2626"
            />
          </g>
        )}
        <circle cx={x(last.budget)} cy={y(last.saved)} r={3} fill="#0284c7" />
      </svg>
    );

    caption = (
      <div className="mt-2 space-y-1 text-xs text-slate-600">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-4 bg-sky-600" /> Rumah selamat
          </span>
          {dredgePt && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-0 border-l border-dashed border-red-600" />{" "}
              Keruk mulai layak: <b>{formatIDR(dredgePt.budget)}</b>
            </span>
          )}
          <span className="ml-auto text-slate-400">anggaran →</span>
        </div>
        <p className="text-slate-500">
          Pada <b>{formatIDR(last.budget)}</b> maksimal{" "}
          <b className="text-emerald-600">{formatNumber(last.saved)}</b> rumah
          selamat
          {dredgePt
            ? `. Di bawah ${formatIDR(dredgePt.budget)} hanya retensi (zona eligible); keruk baru masuk untuk menjangkau zona lain.`
            : "."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">
          Kurva anggaran → rumah selamat
        </h2>
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <span>maks Rp</span>
          <input
            type="number"
            min={100}
            step={100}
            value={maxMiliar}
            onChange={(e) =>
              setMaxMiliar(Math.max(100, Number(e.target.value)))
            }
            className="w-20 rounded-md border border-slate-300 px-2 py-1 tabular-nums"
          />
          <span>M</span>
          <button
            onClick={run}
            disabled={running}
            className="ml-1 rounded-lg bg-slate-900 px-3 py-1 font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
          >
            {running ? "Menghitung…" : points ? "Hitung ulang" : "Hitung kurva"}
          </button>
        </div>
      </div>
      <p className="mb-2 text-xs text-slate-500">
        Hasil maksimal yang bisa dibeli di tiap tingkat anggaran (titik di mana
        keruk mulai layak ditandai merah).
      </p>
      {svg ?? (
        <div className="flex h-[170px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-400">
          {running
            ? "Menghitung kurva…"
            : "Klik “Hitung kurva” untuk menampilkan."}
        </div>
      )}
      {caption}
    </div>
  );
}
