"use client";

import { useMemo, useState } from "react";
import {
  leverSensitivity,
  monteCarlo,
  type SimModel,
  type ParamValues,
  type MonteCarloResult,
} from "@simwilayah/engine";
import { formatIDR, formatNumber } from "@/lib/format";

const MILIAR = 1_000_000_000;

/**
 * Marginal sensitivity — at the current package, which lever returns the most
 * homes per rupiah if pushed further. Answers "rupiah berikutnya ke mana?".
 */
export function SensitivityPanel({
  model,
  drivers,
  levers,
}: {
  model: SimModel;
  drivers: ParamValues;
  levers: ParamValues;
}) {
  const rows = useMemo(
    () => leverSensitivity(model, drivers, levers),
    [model, drivers, levers],
  );
  // homes saved per Rp 1 M, for a readable bar
  const perMiliar = (s: number) => s * MILIAR;
  const maxPer = Math.max(1e-9, ...rows.map((r) => perMiliar(r.savedPerCost)));
  const best = rows.find((r) => r.deltaSaved > 0 && !r.atMax);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="mb-1 text-sm font-semibold text-slate-800">
        Sensitivitas — rupiah berikutnya ke mana?
      </h2>
      <p className="mb-3 text-xs text-slate-500">
        Dari paket sekarang, dampak menambah tiap intervensi (±¼ skala), diurut
        paling untung per rupiah.
        {best ? (
          <>
            {" "}
            Terbaik: <b className="text-emerald-700">{best.label}</b>.
          </>
        ) : (
          <>
            {" "}
            <span className="text-amber-600">
              Paket ini sudah jenuh — penambahan kecil tak menurunkan genangan
              lagi; perlu lompatan besar (lihat Kurva anggaran).
            </span>
          </>
        )}
      </p>

      <div className="space-y-2">
        {rows.map((r) => {
          const per = perMiliar(r.savedPerCost);
          const w = Math.max(0, (per / maxPer) * 100);
          return (
            <div key={r.leverId}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium text-slate-700">{r.label}</span>
                <span className="tabular-nums text-slate-500">
                  {r.atMax ? (
                    <span className="text-slate-400">sudah maksimal</span>
                  ) : r.deltaSaved > 0 ? (
                    <>
                      <b className="text-emerald-600">
                        {formatNumber(per, 1)} rumah
                      </b>{" "}
                      / Rp 1 M
                    </>
                  ) : (
                    <span className="text-slate-400">
                      tak menurunkan genangan
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-0.5 h-2 w-full overflow-hidden rounded bg-slate-100">
                <div
                  className="h-full rounded bg-sky-500"
                  style={{ width: `${w}%` }}
                />
              </div>
              {!r.atMax && r.deltaSaved > 0 && (
                <div className="mt-0.5 text-[10px] text-slate-400">
                  +{formatNumber(r.probe, 1)} {r.unit} → +
                  {formatNumber(r.deltaSaved)} rumah selamat (
                  {formatIDR(r.deltaCost)})
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function pctOf(v: number, lo: number, hi: number) {
  return hi > lo ? ((v - lo) / (hi - lo)) * 100 : 0;
}

/**
 * Monte Carlo risk — runs the current package against an uncertain storm
 * (rainfall + Citarum sampled across their plausible range) and reports the
 * spread of outcomes + reliability. Answers "seberapa aman di tahun buruk?".
 */
export function RiskPanel({
  model,
  drivers,
  levers,
}: {
  model: SimModel;
  drivers: ParamValues;
  levers: ParamValues;
}) {
  const [safeThousand, setSafeThousand] = useState(6);
  const [res, setRes] = useState<MonteCarloResult | null>(null);
  const [running, setRunning] = useState(false);

  function run() {
    setRunning(true);
    setRes(null);
    setTimeout(() => {
      // Vary every driver across its full plausible band, current value as mode.
      const ranges: Record<string, { min: number; mode: number; max: number }> =
        {};
      for (const d of model.drivers) {
        ranges[d.id] = {
          min: d.min,
          mode: drivers[d.id] ?? d.default,
          max: d.max,
        };
      }
      const r = monteCarlo(model, drivers, levers, ranges, {
        runs: 500,
        seed: 1234,
        safeThreshold: safeThousand * 1000,
        primaryKpiId: "households_flooded",
      });
      setRes(r);
      setRunning(false);
    }, 20);
  }

  // histogram
  let hist: React.ReactNode = null;
  if (res) {
    const lo = Math.min(...res.samples);
    const hi = Math.max(...res.samples);
    const bins = 14;
    const counts = new Array(bins).fill(0);
    for (const s of res.samples) {
      const idx = Math.min(
        bins - 1,
        Math.floor(pctOf(s, lo, hi) / (100 / bins)),
      );
      counts[idx]++;
    }
    const maxC = Math.max(1, ...counts);
    const W = 360;
    const H = 90;
    const bw = W / bins;
    hist = (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        <rect x={0} y={0} width={W} height={H} fill="#f8fafc" rx={6} />
        {counts.map((c, i) => {
          const h = (c / maxC) * (H - 8);
          return (
            <rect
              key={i}
              x={i * bw + 1}
              y={H - h}
              width={bw - 2}
              height={h}
              fill="#38bdf8"
              rx={1}
            />
          );
        })}
      </svg>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">
          Risiko (Monte Carlo)
        </h2>
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <span>andal jika ≤</span>
          <input
            type="number"
            min={0}
            step={1}
            value={safeThousand}
            onChange={(e) =>
              setSafeThousand(Math.max(0, Number(e.target.value)))
            }
            className="w-14 rounded-md border border-slate-300 px-2 py-1 tabular-nums"
          />
          <span>rb rmh</span>
          <button
            onClick={run}
            disabled={running}
            className="ml-1 rounded-lg bg-slate-900 px-3 py-1 font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
          >
            {running ? "…" : res ? "Ulang" : "Hitung"}
          </button>
        </div>
      </div>
      <p className="mb-2 text-xs text-slate-500">
        Paket sekarang diuji pada 500 kejadian cuaca acak (hujan &amp; Citarum
        bervariasi) — sebaran rumah terendam.
      </p>

      {res ? (
        <>
          <div className="mb-2 grid grid-cols-3 gap-2 text-center">
            <Stat
              label="Optimistis (p10)"
              value={formatNumber(res.p10)}
              tone="emerald"
            />
            <Stat label="Tipikal (p50)" value={formatNumber(res.p50)} />
            <Stat
              label="Tahun buruk (p90)"
              value={formatNumber(res.p90)}
              tone="red"
            />
          </div>
          {hist}
          <p className="mt-2 text-xs text-slate-600">
            Keandalan:{" "}
            <b
              className={
                res.reliability >= 0.8 ? "text-emerald-600" : "text-amber-600"
              }
            >
              {formatNumber(res.reliability * 100, 0)}%
            </b>{" "}
            kejadian rumah terendam ≤ {formatNumber(safeThousand * 1000)}{" "}
            (rata-rata {formatNumber(res.mean)}).
          </p>
        </>
      ) : (
        <div className="flex h-[150px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-400">
          {running
            ? "Mensimulasikan 500 kejadian…"
            : "Klik “Hitung” untuk uji risiko paket ini."}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "emerald" | "red";
}) {
  const cls =
    tone === "emerald"
      ? "text-emerald-600"
      : tone === "red"
        ? "text-red-600"
        : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className={`text-lg font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
