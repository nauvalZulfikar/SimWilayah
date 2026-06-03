import type { Kpi, ParamValues, SimModel, SimResult } from "./types";
import { leverCost, baselineLevers } from "./types";
import { mulberry32, triangular } from "./rng";

function kpiValue(result: SimResult, kpiId: string): number {
  const k = result.kpis.find((x) => x.id === kpiId);
  return k ? k.value : NaN;
}

export interface Comparison {
  baseline: SimResult;
  scenario: SimResult;
  primaryKpi: Kpi;
  /** Absolute improvement in the primary KPI (always >= 0 means "better"). */
  improvement: number;
  improvementPct: number;
  cost: number;
  /** IDR spent per unit of improvement. Infinity if the scenario helps nothing. */
  costPerUnitImprovement: number;
}

/**
 * Run the do-nothing baseline against a funded scenario under the same
 * environmental drivers, and quantify how cost-effective the intervention is.
 */
export function compare(
  model: SimModel,
  drivers: ParamValues,
  scenarioLevers: ParamValues,
  primaryKpiId: string = model.primaryKpiId,
): Comparison {
  // Baseline = what is already built (existing infrastructure), not zero.
  const baseline = model.run({ drivers, levers: baselineLevers(model) });
  const scenario = model.run({ drivers, levers: scenarioLevers });

  const primaryKpi = scenario.kpis.find((k) => k.id === primaryKpiId)!;
  const base = kpiValue(baseline, primaryKpiId);
  const scen = kpiValue(scenario, primaryKpiId);

  // Normalise "improvement" so positive always means a better outcome.
  const improvement = primaryKpi.betterWhenLower ? base - scen : scen - base;
  const improvementPct = base !== 0 ? (improvement / Math.abs(base)) * 100 : 0;
  const cost = scenario.totalCost;
  const costPerUnitImprovement =
    improvement > 1e-9 ? cost / improvement : Infinity;

  return {
    baseline,
    scenario,
    primaryKpi,
    improvement,
    improvementPct,
    cost,
    costPerUnitImprovement,
  };
}

export interface RankedScenario {
  name: string;
  levers: ParamValues;
  comparison: Comparison;
}

/**
 * Rank a set of candidate intervention packages by cost-effectiveness
 * (cheapest IDR per unit of improvement first). This is what tells the
 * government "solusi mana paling murah-paling-efektif".
 */
export function rankScenarios(
  model: SimModel,
  drivers: ParamValues,
  candidates: { name: string; levers: ParamValues }[],
  primaryKpiId: string = model.primaryKpiId,
): RankedScenario[] {
  return candidates
    .map((c) => ({
      name: c.name,
      levers: c.levers,
      comparison: compare(model, drivers, c.levers, primaryKpiId),
    }))
    .sort(
      (a, b) =>
        a.comparison.costPerUnitImprovement -
        b.comparison.costPerUnitImprovement,
    );
}

export interface OptimizeOptions {
  /** Hard budget cap in IDR. The returned package never costs more than this. */
  budget: number;
  /** KPI to optimise. Defaults to the model's primary KPI. */
  targetKpiId?: string;
  /** Safety cap on combinations evaluated. Default 2,000,000. */
  maxEvaluations?: number;
  /**
   * Jurisdiction filter: only levers whose `scope` is in this list may be funded
   * (others are locked at their existing level — i.e. cannot be added). Lets the
   * pemda ask "what can the kabupaten do alone?" vs "all agencies together?".
   * Levers without a `scope` are always allowed. Omit to allow everything.
   */
  allowedScopes?: Array<"pusat" | "provinsi" | "kabupaten">;
}

export interface OptimizeResult {
  targetKpiId: string;
  budget: number;
  /** Primary-KPI value of the do-nothing baseline (for "saved vs baseline"). */
  baselineKpi: number;
  /** Best affordable package found. Never null for budget >= 0 (all-zero is always affordable). */
  best: {
    levers: ParamValues;
    cost: number;
    kpi: number;
    comparison: Comparison;
  };
  /** Number of feasible (within-budget) combinations actually run. */
  evaluated: number;
  /** True if the safety cap stopped the search early (result may be sub-optimal). */
  truncated: boolean;
}

/**
 * Find the lever package that optimises `targetKpiId` without exceeding `budget`.
 *
 * This is the "Optimasi" button: instead of the user nudging sliders by hand, it
 * exhaustively searches every combination of lever values (on each lever's own
 * min/max/step grid) and returns the affordable mix that helps most — the core
 * of "perencanaan & budgeting" for the pemda.
 *
 * The search is exhaustive (so the result is the true optimum within the grid),
 * made cheap by pruning: lever grids are ascending and cost is non-decreasing in
 * each lever, so once a partial cost exceeds the budget the rest of that branch
 * is skipped. The all-levers-off package (cost 0) is always in range, so `best`
 * is always defined; if nothing affordable beats the baseline its improvement is 0.
 */
export function optimize(
  model: SimModel,
  drivers: ParamValues,
  opts: OptimizeOptions,
): OptimizeResult {
  const targetKpiId = opts.targetKpiId ?? model.primaryKpiId;
  const cap = opts.maxEvaluations ?? 2_000_000;

  // Baseline = existing infrastructure (can't un-build), not zero.
  const baseline = model.run({ drivers, levers: baselineLevers(model) });
  const baseKpi = baseline.kpis.find((k) => k.id === targetKpiId);
  if (!baseKpi) throw new Error(`optimize: unknown KPI "${targetKpiId}"`);
  const betterWhenLower = baseKpi.betterWhenLower;

  const specs = model.levers;
  const scopeAllowed = (s: (typeof specs)[number]) =>
    !opts.allowedScopes || !s.scope || opts.allowedScopes.includes(s.scope);
  // Candidate values per lever start at the EXISTING level (you can only add to
  // what's already there) and ascend to max on the lever's own step. A lever
  // outside the allowed jurisdiction is pinned to its existing level (single
  // grid point) — it stays in the baseline but can never be funded.
  const grids = specs.map((s) => {
    const lo = Math.max(s.min, model.existing?.[s.id] ?? 0);
    if (!scopeAllowed(s)) return [lo];
    const n = Math.floor((s.max - lo) / s.step + 1e-9) + 1;
    return Array.from({ length: n }, (_, k) => +(lo + k * s.step).toFixed(6));
  });
  const costOf = (i: number, v: number) => {
    const sp = specs[i]!;
    const ex = model.existing?.[sp.id] ?? 0;
    const added = v - ex;
    return added > 1e-9
      ? added * sp.costPerUnit + (ex <= 0 ? sp.fixedCost : 0)
      : 0;
  };

  let bestKpi = betterWhenLower ? Infinity : -Infinity;
  let bestCost = Infinity;
  let bestLevers: ParamValues = baselineLevers(model);
  let evaluated = 0;
  let truncated = false;

  const current: ParamValues = {};

  function recurse(i: number, accCost: number) {
    if (truncated) return;
    if (i === specs.length) {
      evaluated++;
      const res = model.run({ drivers, levers: current });
      const v = res.kpis.find((k) => k.id === targetKpiId)!.value;
      const isBetter = betterWhenLower ? v < bestKpi : v > bestKpi;
      const isCheaperTie = v === bestKpi && accCost < bestCost;
      if (isBetter || isCheaperTie) {
        bestKpi = v;
        bestCost = accCost;
        bestLevers = { ...current };
      }
      if (evaluated >= cap) truncated = true;
      return;
    }
    for (const v of grids[i]!) {
      const c = costOf(i, v);
      // Grids ascend and cost is non-decreasing in v → once over budget, stop.
      if (accCost + c > opts.budget) break;
      current[specs[i]!.id] = v;
      recurse(i + 1, accCost + c);
      if (truncated) return;
    }
  }
  recurse(0, 0);

  const comparison = compare(model, drivers, bestLevers, targetKpiId);
  return {
    targetKpiId,
    budget: opts.budget,
    baselineKpi: baseKpi.value,
    best: {
      levers: bestLevers,
      cost: leverCost(model, bestLevers),
      kpi: bestKpi,
      comparison,
    },
    evaluated,
    truncated,
  };
}

export interface LeverSensitivity {
  leverId: string;
  label: string;
  /** Size of the probe bump applied to this lever (in its own unit). */
  probe: number;
  unit: string;
  /** Extra improvement (e.g. homes saved) from the probe bump at the current point. */
  deltaSaved: number;
  /** Extra IDR for that bump. */
  deltaCost: number;
  /** Improvement per IDR (0 if the bump costs nothing or does nothing). */
  savedPerCost: number;
  /** Lever already at its maximum (no further bump possible). */
  atMax: boolean;
}

/**
 * Marginal sensitivity at the *current* operating point: for each lever, how
 * much extra improvement (and cost) a bump buys, holding the others fixed.
 * Sorted most-effective-per-rupiah first, this answers "rupiah berikutnya paling
 * untung dipakai ke mana" — the day-to-day budgeting question.
 *
 * The probe is `probeFraction` of the lever's range (default ¼) rather than a
 * single step: the household KPI is discrete, so a one-step nudge often fails to
 * push any zone across the flood threshold and reads a misleading zero.
 */
export function leverSensitivity(
  model: SimModel,
  drivers: ParamValues,
  levers: ParamValues,
  targetKpiId: string = model.primaryKpiId,
  probeFraction = 0.25,
): LeverSensitivity[] {
  const baseRun = model.run({ drivers, levers });
  const baseKpi = baseRun.kpis.find((k) => k.id === targetKpiId);
  if (!baseKpi)
    throw new Error(`leverSensitivity: unknown KPI "${targetKpiId}"`);
  const betterWhenLower = baseKpi.betterWhenLower;
  const baseVal = baseKpi.value;
  const baseCost = leverCost(model, levers);

  return model.levers
    .map((spec) => {
      const cur = levers[spec.id] ?? 0;
      const probeSize = Math.max(
        spec.step,
        (spec.max - spec.min) * probeFraction,
      );
      const next = Math.min(spec.max, cur + probeSize);
      const probe = next - cur;
      const atMax = probe <= 1e-9;
      const bumped = { ...levers, [spec.id]: next };
      const r = model.run({ drivers, levers: bumped });
      const v = r.kpis.find((k) => k.id === targetKpiId)!.value;
      const deltaSaved = betterWhenLower ? baseVal - v : v - baseVal;
      const deltaCost = leverCost(model, bumped) - baseCost;
      const savedPerCost = deltaCost > 1e-9 ? deltaSaved / deltaCost : 0;
      return {
        leverId: spec.id,
        label: spec.label,
        probe,
        unit: spec.unit,
        deltaSaved,
        deltaCost,
        savedPerCost,
        atMax,
      };
    })
    .sort((a, b) => b.savedPerCost - a.savedPerCost);
}

export interface FrontierPoint {
  budget: number;
  /** Best affordable improvement in the target KPI (homes saved) at this budget. */
  saved: number;
  kpi: number;
  /** Actual cost of the package chosen at this budget. */
  cost: number;
  levers: ParamValues;
}

/**
 * Budget → best-outcome curve. Runs {@link optimize} across a sweep of budgets
 * so the UI can draw the "diminishing returns" curve and show at which budget a
 * new lever (e.g. dredging) first becomes worth funding.
 *
 * The curve is monotonic: more budget never lowers `saved` (a richer budget can
 * always re-buy the cheaper package). Wall-clock is `steps` exhaustive searches;
 * each is cheap thanks to the same cost-pruning `optimize` uses.
 */
export function budgetFrontier(
  model: SimModel,
  drivers: ParamValues,
  opts: { maxBudget: number; steps?: number; targetKpiId?: string },
): FrontierPoint[] {
  const steps = Math.max(1, opts.steps ?? 20);
  const out: FrontierPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const budget = (opts.maxBudget * i) / steps;
    const r = optimize(model, drivers, {
      budget,
      targetKpiId: opts.targetKpiId,
    });
    out.push({
      budget,
      saved: Math.max(0, r.best.comparison.improvement),
      kpi: r.best.kpi,
      cost: r.best.cost,
      levers: r.best.levers,
    });
  }
  return out;
}

export interface MonteCarloResult {
  runs: number;
  primaryKpiId: string;
  mean: number;
  p10: number;
  p50: number;
  p90: number;
  /** Share of runs where the primary KPI stays under `safeThreshold`. */
  reliability: number;
  samples: number[];
}

/**
 * Stress-test a lever set against uncertain drivers (e.g. rainfall could be
 * worse than the design storm). Each named driver is sampled from a triangular
 * low/mode/high range. Answers "how robust is this solution to a bad year?".
 */
export function monteCarlo(
  model: SimModel,
  baseDrivers: ParamValues,
  levers: ParamValues,
  driverRanges: Record<string, { min: number; mode: number; max: number }>,
  opts: {
    runs?: number;
    seed?: number;
    safeThreshold?: number;
    primaryKpiId?: string;
  } = {},
): MonteCarloResult {
  const runs = opts.runs ?? 500;
  const rand = mulberry32(opts.seed ?? 1234);
  const primaryKpiId = opts.primaryKpiId ?? model.primaryKpiId;
  const samples: number[] = [];
  let safe = 0;

  for (let i = 0; i < runs; i++) {
    const drivers: ParamValues = { ...baseDrivers };
    for (const [id, r] of Object.entries(driverRanges)) {
      drivers[id] = triangular(rand, r.min, r.mode, r.max);
    }
    const result = model.run({ drivers, levers });
    const v = kpiValue(result, primaryKpiId);
    samples.push(v);
    if (opts.safeThreshold != null && v <= opts.safeThreshold) safe++;
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const q = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  const mean = samples.reduce((s, x) => s + x, 0) / samples.length;

  return {
    runs,
    primaryKpiId,
    mean,
    p10: q(0.1),
    p50: q(0.5),
    p90: q(0.9),
    reliability: opts.safeThreshold != null ? safe / runs : NaN,
    samples,
  };
}

export { leverCost };
