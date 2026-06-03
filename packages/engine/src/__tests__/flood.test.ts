import { describe, it, expect } from "vitest";
import {
  tegalluarModel,
  tegalluarConfig,
  tegalluarPresets,
  compare,
  rankScenarios,
  monteCarlo,
  optimize,
  budgetFrontier,
  leverSensitivity,
  zeroLevers,
  defaultDrivers,
  leverCost,
} from "../index";

const MILIAR = 1_000_000_000;

const drivers = defaultDrivers(tegalluarModel);

function kpi(result: ReturnType<typeof tegalluarModel.run>, id: string) {
  return result.kpis.find((k) => k.id === id)!.value;
}

describe("Tegalluar flood model — baseline behaviour", () => {
  it("floods thousands of households under the design storm with no intervention", () => {
    const res = tegalluarModel.run({
      drivers,
      levers: zeroLevers(tegalluarModel),
    });
    expect(kpi(res, "households_flooded")).toBeGreaterThan(1000);
    // Observed depths were 0.6–1.2 m; our peak should land in a plausible band.
    expect(kpi(res, "peak_depth_m")).toBeGreaterThan(0.4);
  });

  it("produces an hourly timeline that crests then recedes", () => {
    const res = tegalluarModel.run({
      drivers,
      levers: zeroLevers(tegalluarModel),
    });
    const depths = res.timeline.map((t) => t.series.max_depth_m!);
    const peak = Math.max(...depths);
    expect(peak).toBeGreaterThan(0);
    // last hour should be below the peak (water draining as river recedes)
    expect(depths[depths.length - 1]!).toBeLessThanOrEqual(peak);
  });

  it("low zones at the confluence flood while high fringes stay dry", () => {
    const res = tegalluarModel.run({
      drivers,
      levers: zeroLevers(tegalluarModel),
    });
    const byId = Object.fromEntries(res.zones.map((z) => [z.zoneId, z]));
    expect(byId.muara!.severity).toBeGreaterThan(byId.panyileukan!.severity);
    expect(byId.panyileukan!.status).toBe("ok");
  });
});

describe("Backwater mechanism", () => {
  it("a higher Citarum makes flooding worse (drainage locks up)", () => {
    const calm = tegalluarModel.run({
      drivers: { ...drivers, upstream_rise_m: 0.5 },
      levers: zeroLevers(tegalluarModel),
    });
    const swollen = tegalluarModel.run({
      drivers: { ...drivers, upstream_rise_m: 4.5 },
      levers: zeroLevers(tegalluarModel),
    });
    expect(kpi(swollen, "households_flooded")).toBeGreaterThan(
      kpi(calm, "households_flooded"),
    );
  });
});

describe("Intervention levers each reduce flooding", () => {
  const base = tegalluarModel.run({
    drivers,
    levers: zeroLevers(tegalluarModel),
  });
  const baseHh = kpi(base, "households_flooded");

  it("dredging lowers the river and reduces flooded households", () => {
    const res = tegalluarModel.run({
      drivers,
      levers: { dredge: 10, retention: 0, drainage: 0, ews: 0 },
    });
    expect(kpi(res, "households_flooded")).toBeLessThan(baseHh);
  });

  it("retention storage reduces flooded households", () => {
    const res = tegalluarModel.run({
      drivers,
      levers: { dredge: 0, retention: 6, drainage: 0, ews: 0 },
    });
    expect(kpi(res, "households_flooded")).toBeLessThan(baseHh);
  });

  it("EWS does NOT reduce depth but DOES reduce households-without-warning", () => {
    const noEws = tegalluarModel.run({
      drivers,
      levers: { dredge: 0, retention: 0, drainage: 0, ews: 0 },
    });
    const withEws = tegalluarModel.run({
      drivers,
      levers: { dredge: 0, retention: 0, drainage: 0, ews: 100 },
    });
    expect(kpi(withEws, "households_flooded")).toBe(
      kpi(noEws, "households_flooded"),
    ); // depth unchanged
    expect(kpi(withEws, "households_no_warning")).toBeLessThan(
      kpi(noEws, "households_no_warning"),
    );
  });

  it("the integrated package beats any single lever", () => {
    const integrated = tegalluarPresets.find((p) => p.id === "integrated")!;
    const res = tegalluarModel.run({ drivers, levers: integrated.levers });
    expect(kpi(res, "households_flooded")).toBeLessThan(baseHh * 0.5);
  });
});

describe("Cost & cost-effectiveness", () => {
  it("computes a non-zero cost for funded levers and zero for the baseline", () => {
    expect(leverCost(tegalluarModel, zeroLevers(tegalluarModel))).toBe(0);
    expect(
      leverCost(tegalluarModel, {
        dredge: 10,
        retention: 0,
        drainage: 0,
        ews: 0,
      }),
    ).toBeGreaterThan(0);
  });

  it("compare() reports positive improvement and a finite cost-per-household", () => {
    const c = compare(tegalluarModel, drivers, {
      dredge: 8,
      retention: 5,
      drainage: 60,
      ews: 100,
    });
    expect(c.improvement).toBeGreaterThan(0);
    expect(c.costPerUnitImprovement).toBeGreaterThan(0);
    expect(Number.isFinite(c.costPerUnitImprovement)).toBe(true);
  });

  it("ranks candidate packages cheapest-per-improvement first", () => {
    const ranked = rankScenarios(
      tegalluarModel,
      drivers,
      tegalluarPresets
        .filter((p) => p.id !== "baseline")
        .map((p) => ({ name: p.name, levers: p.levers })),
    );
    expect(ranked.length).toBeGreaterThan(1);
    for (let i = 1; i < ranked.length; i++) {
      expect(
        ranked[i]!.comparison.costPerUnitImprovement,
      ).toBeGreaterThanOrEqual(
        ranked[i - 1]!.comparison.costPerUnitImprovement,
      );
    }
  });
});

describe("Budget optimiser (Optimasi)", () => {
  const baseHh = kpi(
    tegalluarModel.run({ drivers, levers: zeroLevers(tegalluarModel) }),
    "households_flooded",
  );

  it("never recommends a package that exceeds the budget", () => {
    const budget = 200 * MILIAR;
    const r = optimize(tegalluarModel, drivers, { budget });
    expect(r.best.cost).toBeLessThanOrEqual(budget);
    expect(leverCost(tegalluarModel, r.best.levers)).toBeLessThanOrEqual(
      budget,
    );
  });

  it("with a generous budget it beats the do-nothing baseline", () => {
    const r = optimize(tegalluarModel, drivers, { budget: 800 * MILIAR });
    expect(
      kpi(
        tegalluarModel.run({ drivers, levers: r.best.levers }),
        "households_flooded",
      ),
    ).toBeLessThan(baseHh);
    expect(r.best.comparison.improvement).toBeGreaterThan(0);
  });

  it("a zero budget yields the all-off package (cost 0, no improvement)", () => {
    const r = optimize(tegalluarModel, drivers, { budget: 0 });
    expect(r.best.cost).toBe(0);
    expect(r.best.comparison.improvement).toBe(0);
  });

  it("more budget never produces a worse optimum (monotonic)", () => {
    const lo = optimize(tegalluarModel, drivers, { budget: 100 * MILIAR });
    const hi = optimize(tegalluarModel, drivers, { budget: 600 * MILIAR });
    // households_flooded is better-when-lower → more budget ⇒ KPI <= .
    expect(hi.best.kpi).toBeLessThanOrEqual(lo.best.kpi);
  });

  it("optimising 'no warning' funds EWS; optimising 'flooded' does not", () => {
    const budget = 60 * MILIAR; // affords EWS, not a meaningful dredge
    const forWarning = optimize(tegalluarModel, drivers, {
      budget,
      targetKpiId: "households_no_warning",
    });
    const forFlood = optimize(tegalluarModel, drivers, {
      budget,
      targetKpiId: "households_flooded",
    });
    expect(forWarning.best.levers.ews).toBeGreaterThan(0); // EWS protects the unwarned
    expect(forFlood.best.levers.ews ?? 0).toBe(0); // EWS doesn't cut depth → wasted here
  });
});

describe("Budget frontier (kurva anggaran)", () => {
  it("is monotonic — more budget never saves fewer homes", () => {
    const f = budgetFrontier(tegalluarModel, drivers, {
      maxBudget: 1000 * MILIAR,
      steps: 12,
    });
    expect(f.length).toBe(13);
    for (let i = 1; i < f.length; i++) {
      expect(f[i]!.saved).toBeGreaterThanOrEqual(f[i - 1]!.saved);
      expect(f[i]!.cost).toBeLessThanOrEqual(f[i]!.budget);
    }
    expect(f[0]!.saved).toBe(0); // zero budget saves nothing
    expect(f[f.length - 1]!.saved).toBeGreaterThan(f[0]!.saved);
  });

  it("eventually funds dredging at a high enough budget", () => {
    const f = budgetFrontier(tegalluarModel, drivers, {
      maxBudget: 1200 * MILIAR,
      steps: 12,
    });
    expect(f.some((p) => (p.levers.dredge ?? 0) > 0)).toBe(true);
  });
});

describe("Lever sensitivity (marginal)", () => {
  it("ranks levers by homes-per-rupiah and flags EWS as zero for flooding", () => {
    const s = leverSensitivity(
      tegalluarModel,
      drivers,
      zeroLevers(tegalluarModel),
    );
    expect(s.length).toBe(tegalluarModel.levers.length);
    // sorted descending by cost-effectiveness
    for (let i = 1; i < s.length; i++) {
      expect(s[i]!.savedPerCost).toBeLessThanOrEqual(s[i - 1]!.savedPerCost);
    }
    // EWS cannot reduce flooded households → zero marginal on that KPI
    expect(s.find((x) => x.leverId === "ews")!.deltaSaved).toBe(0);
    // At the design storm the basin is saturated (every flooded zone is deep), so
    // a single ¼-range probe of one lever may not clear a whole discrete zone.
    // At a near-threshold storm a structural lever must still buy marginal saving.
    const light = { rain_mm: 60, duration_h: 5, upstream_rise_m: 1.5 };
    const sl = leverSensitivity(
      tegalluarModel,
      light,
      zeroLevers(tegalluarModel),
    );
    expect(sl[0]!.deltaSaved).toBeGreaterThan(0);
    expect(sl.find((x) => x.leverId === "ews")!.deltaSaved).toBe(0);
  });

  it("marks a maxed lever as atMax with no further step", () => {
    const maxed = { dredge: 12, retention: 0, drainage: 0, ews: 0 };
    const s = leverSensitivity(tegalluarModel, drivers, maxed);
    expect(s.find((x) => x.leverId === "dredge")!.atMax).toBe(true);
  });
});

describe("Monte Carlo robustness", () => {
  it("is deterministic for a fixed seed and reports a reliability share", () => {
    const ranges = {
      rain_mm: { min: 60, mode: 95, max: 180 },
      upstream_rise_m: { min: 1.5, mode: 3.2, max: 4.8 },
    };
    const levers = { dredge: 8, retention: 5, drainage: 60, ews: 0 };
    const a = monteCarlo(tegalluarModel, drivers, levers, ranges, {
      runs: 200,
      seed: 42,
      safeThreshold: 1500,
    });
    const b = monteCarlo(tegalluarModel, drivers, levers, ranges, {
      runs: 200,
      seed: 42,
      safeThreshold: 1500,
    });
    expect(a.mean).toBe(b.mean);
    expect(a.reliability).toBeGreaterThanOrEqual(0);
    expect(a.reliability).toBeLessThanOrEqual(1);
    expect(a.p90).toBeGreaterThanOrEqual(a.p10);
  });
});

describe("Config integrity", () => {
  it("every preset only references real lever ids", () => {
    const leverIds = new Set(tegalluarConfig.levers.map((l) => l.id));
    for (const p of tegalluarPresets) {
      for (const id of Object.keys(p.levers))
        expect(leverIds.has(id)).toBe(true);
    }
  });

  it("every zone carries real coordinates + an SRTM sample for the geo map", () => {
    for (const z of tegalluarModel.zones) {
      expect(z.attrs.lat).toBeLessThan(-6); // southern hemisphere, Bandung
      expect(z.attrs.lng).toBeGreaterThan(107);
      expect(z.attrs.srtm_elevation_m).toBeGreaterThan(600);
    }
  });
});
