"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  tegalluarModel as model,
  tegalluarPresets,
  tegalluarRainScenarios,
  compare,
  rankScenarios,
  baselineLevers,
  defaultDrivers,
  leverCost,
  type ParamValues,
  type PresetScenario,
  type RainScenario,
} from "@simwilayah/engine";

import { ZoneMap, MapLegend } from "@/components/zone-map";
import { TimelineChart } from "@/components/charts";
import { ParamGroup } from "@/components/controls";
import { OptimizePanel } from "@/components/optimize";
import {
  ZoneImpactTable,
  CostBreakdown,
  BudgetCurve,
} from "@/components/breakdown";
import { SensitivityPanel, RiskPanel } from "@/components/analytics";
import {
  PresetBar,
  KpiCards,
  CostEffectivenessCard,
  RankingTable,
  RainScenarioBar,
  WarningPanel,
} from "@/components/panels";
import { formatIDR } from "@/lib/format";

// MapLibre touches `window`, so load the geo map client-side only.
const GeoMap = dynamic(
  () => import("@/components/geo-map").then((m) => m.GeoMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[460px] items-center justify-center rounded-xl border border-slate-200 text-sm text-slate-400">
        Memuat peta…
      </div>
    ),
  },
);

const candidatePresets = tegalluarPresets.filter((p) => p.id !== "baseline");

export default function Page() {
  const [drivers, setDrivers] = useState<ParamValues>(() =>
    defaultDrivers(model),
  );
  const [levers, setLevers] = useState<ParamValues>(() =>
    baselineLevers(model),
  );
  const [activePreset, setActivePreset] = useState<string | null>("baseline");
  const [activeRain, setActiveRain] = useState<string | null>("q5");

  // Clamp a lever set so nothing drops below what's already built (existing).
  const clampExisting = (lv: ParamValues): ParamValues => {
    const out: ParamValues = { ...lv };
    for (const l of model.levers) {
      const ex = model.existing?.[l.id] ?? 0;
      out[l.id] = Math.max(ex, out[l.id] ?? 0);
    }
    return out;
  };
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<"geo" | "schema">("geo");

  const { scenario, baseline, comparison, ranked, cost } = useMemo(() => {
    return {
      scenario: model.run({ drivers, levers }),
      baseline: model.run({ drivers, levers: baselineLevers(model) }),
      comparison: compare(model, drivers, levers),
      ranked: rankScenarios(
        model,
        drivers,
        candidatePresets.map((p) => ({ name: p.name, levers: p.levers })),
      ),
      cost: leverCost(model, levers),
    };
  }, [drivers, levers]);

  function setDriver(id: string, v: number) {
    setDrivers((d) => ({ ...d, [id]: v }));
    setActiveRain(null);
  }
  function applyRain(s: RainScenario) {
    setDrivers({ ...defaultDrivers(model), ...s.drivers });
    setActiveRain(s.id);
  }
  function setLever(id: string, v: number) {
    const ex = model.existing?.[id] ?? 0;
    setLevers((l) => ({ ...l, [id]: Math.max(ex, v) }));
    setActivePreset(null);
  }
  function applyPreset(p: PresetScenario) {
    setLevers(clampExisting({ ...baselineLevers(model), ...p.levers }));
    setActivePreset(p.id);
  }

  const selected = selectedZone
    ? scenario.zones.find((z) => z.zoneId === selectedZone)
    : null;
  const selectedMeta = selectedZone
    ? model.zones.find((z) => z.id === selectedZone)
    : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 lg:px-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-sky-700">
            SimWilayah · Decision Sandbox
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
            {model.title}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
            {model.description}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 print:hidden"
          title="Cetak / simpan sebagai PDF untuk rapat koordinasi"
        >
          🖨️ Cetak / PDF
        </button>
      </header>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Paket solusi (preset usulan pemda)
          </p>
          <PresetBar
            presets={tegalluarPresets}
            activeId={activePreset}
            onPick={applyPreset}
          />
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Skenario hujan (kala ulang)
          </p>
          <RainScenarioBar
            scenarios={tegalluarRainScenarios}
            activeId={activeRain}
            onPick={applyRain}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* ---- Controls ---- */}
        <aside className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 print:hidden">
          <ParamGroup
            title="Skenario cuaca / kondisi"
            specs={model.drivers}
            values={drivers}
            onChange={setDriver}
            accent="#0ea5e9"
          />
          <hr className="border-slate-100" />
          <ParamGroup
            title="Intervensi (lever kebijakan)"
            specs={model.levers}
            values={levers}
            onChange={setLever}
            accent="#0f172a"
            existing={model.existing}
          />
          <div className="rounded-xl bg-slate-900 p-4 text-white">
            <div className="text-xs uppercase tracking-wide text-slate-400">
              Total anggaran skenario
            </div>
            <div className="mt-1 text-2xl font-bold">{formatIDR(cost)}</div>
          </div>
          <OptimizePanel
            model={model}
            drivers={drivers}
            onApply={(lv) => {
              setLevers(clampExisting({ ...baselineLevers(model), ...lv }));
              setActivePreset(null);
            }}
          />
        </aside>

        {/* ---- Results ---- */}
        <main className="space-y-6">
          <KpiCards scenario={scenario} baseline={baseline} />

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-800">
                  Peta genangan per zona
                </h2>
                <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
                  <button
                    onClick={() => setMapMode("geo")}
                    className={`rounded-md px-2 py-1 ${mapMode === "geo" ? "bg-slate-900 text-white" : "text-slate-500"}`}
                  >
                    Peta nyata
                  </button>
                  <button
                    onClick={() => setMapMode("schema")}
                    className={`rounded-md px-2 py-1 ${mapMode === "schema" ? "bg-slate-900 text-white" : "text-slate-500"}`}
                  >
                    Skema
                  </button>
                </div>
              </div>
              {mapMode === "geo" ? (
                <GeoMap
                  model={model}
                  zones={scenario.zones}
                  selectedZoneId={selectedZone}
                  onSelectZone={setSelectedZone}
                />
              ) : (
                <ZoneMap
                  model={model}
                  zones={scenario.zones}
                  selectedZoneId={selectedZone}
                  onSelectZone={setSelectedZone}
                />
              )}
              <div className="mt-3">
                <MapLegend />
              </div>
              {selected && selectedMeta && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                  <span className="font-semibold text-slate-800">
                    {selectedMeta.name}
                  </span>{" "}
                  · {selected.detail.households.toLocaleString("id-ID")} rumah ·
                  kedalaman puncak{" "}
                  <span className="font-semibold">
                    {selected.severity.toFixed(2)} m
                  </span>
                  <br />
                  <span className="text-slate-400">
                    Datum kalibrasi {selected.detail.elevation_m} mdpl · SRTM30m{" "}
                    {selectedMeta.attrs.srtm_elevation_m} mdpl ·{" "}
                    {selectedMeta.attrs.lat.toFixed(4)},{" "}
                    {selectedMeta.attrs.lng.toFixed(4)}
                  </span>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">
                Dinamika kejadian (per jam)
              </h2>
              <TimelineChart timeline={scenario.timeline} />
              <div className="mt-4">
                <CostEffectivenessCard comparison={comparison} />
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <ZoneImpactTable
              model={model}
              zones={scenario.zones}
              baselineZones={baseline.zones}
              costPerHomeSaved={comparison.costPerUnitImprovement}
            />
            <CostBreakdown model={model} levers={levers} />
            <WarningPanel model={model} scenario={scenario} />
            <div className="grid gap-6 lg:grid-cols-2">
              <SensitivityPanel
                model={model}
                drivers={drivers}
                levers={levers}
              />
              <RiskPanel model={model} drivers={drivers} levers={levers} />
            </div>
            <BudgetCurve model={model} drivers={drivers} />
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">
              Perbandingan paket solusi
            </h2>
            <RankingTable ranked={ranked} />
          </div>
        </main>
      </div>

      <footer className="mt-10 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-400">
        Model water-balance tersederhanakan · parameter dari laporan publik
        2024–2026, dapat dikalibrasi ulang. Koordinat zona nyata (WGS84);
        elevasi acuan SRTM30m (OpenTopoData) — namun galat vertikal SRTM (~6–16
        m) melebihi kedalaman banjir, sehingga simulasi memakai datum kalibrasi,
        bukan SRTM mentah. Bukan pengganti studi hidrologi teknis (DEMNAS/LiDAR
        + HEC-RAS/InfoWorks ICM).
      </footer>
    </div>
  );
}
