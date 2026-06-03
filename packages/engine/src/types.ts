/**
 * SimWilayah — generic region-policy simulation framework.
 *
 * The core is domain-agnostic: it knows about Zones, adjustable Parameters
 * (drivers + levers), KPIs and per-zone Outcomes. A *domain* (flood, traffic,
 * waste, …) is a plugin that implements {@link SimModel}. This keeps the same
 * engine reusable for "berbagai macam masalah di daerah manapun".
 */

/** A spatial unit of the region (a kelurahan, RW, grid cell, district …). */
export interface Zone {
  id: string;
  name: string;
  /** Map placement. For the built-in SVG map these are 0..100 layout coords. */
  x: number;
  y: number;
  area_m2: number;
  /** Domain-specific numeric attributes (elevation, population, …). */
  attrs: Record<string, number>;
}

/**
 * An adjustable parameter. Used for BOTH environmental drivers (rainfall,
 * river rise — what the world throws at us) and policy levers (interventions
 * the government can fund). Levers carry a cost; drivers leave cost at 0.
 */
export interface ParamSpec {
  id: string;
  label: string;
  description: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** IDR per unit of value. 0 for drivers (they are not purchased). */
  costPerUnit: number;
  /** One-off IDR cost incurred when value > 0 (land acquisition, mobilisation). */
  fixedCost: number;
  /**
   * Which agency holds the legal mandate to build/operate this lever. The flood
   * problem spans jurisdictions (national river vs provincial polder vs local
   * drainage), so a lever is only actionable by whoever owns it. Optional;
   * drivers leave it unset.
   */
  authority?: string;
  /** Budget source that pays for it (e.g. "APBN", "APBD Prov", "APBD Kab"). */
  fundingSource?: string;
  /**
   * Coarse jurisdiction tier used by the optimiser's "who can act" filter.
   * `optimize({ allowedScopes })` locks every lever outside the allowed tiers at
   * its existing level — so the pemda can ask "what can WE do alone vs what needs
   * the centre". Optional; unset levers are treated as always-allowed.
   */
  scope?: "pusat" | "provinsi" | "kabupaten";
}

export type ParamValues = Record<string, number>;

export interface ScenarioInput {
  /** Environmental conditions (rain_mm, upstream_rise_m, …). */
  drivers: ParamValues;
  /** Policy interventions and their funded magnitudes. */
  levers: ParamValues;
}

export interface Kpi {
  id: string;
  label: string;
  value: number;
  unit: string;
  /** True if a lower number is the better outcome (flood depth, cost, …). */
  betterWhenLower: boolean;
}

export type ZoneStatus = "ok" | "warning" | "critical";

export interface ZoneOutcome {
  zoneId: string;
  /** Primary metric used to colour the map (e.g. flood depth in metres). */
  severity: number;
  status: ZoneStatus;
  detail: Record<string, number>;
}

export interface TimeStep {
  /** Hour index within the event. */
  t: number;
  series: Record<string, number>;
}

export interface SimResult {
  kpis: Kpi[];
  zones: ZoneOutcome[];
  timeline: TimeStep[];
  /** Total intervention cost in IDR for the lever set that produced this run. */
  totalCost: number;
}

/** Contract every domain plugin must satisfy. */
export interface SimModel {
  id: string;
  title: string;
  description: string;
  zones: Zone[];
  /** Interventions the user can fund. */
  levers: ParamSpec[];
  /**
   * Amount of each lever ALREADY in place (existing infrastructure). The
   * do-nothing baseline runs at these levels — not zero — and funding only pays
   * for the amount built ABOVE existing. Levers omitted here are treated as 0.
   */
  existing: ParamValues;
  /** Environmental conditions the user can stress-test against. */
  drivers: ParamSpec[];
  /** Label of the KPI used as the default optimisation target. */
  primaryKpiId: string;
  /** Severity unit for the map legend (e.g. "m" for flood depth). */
  severityLabel: string;
  run(input: ScenarioInput): SimResult;
}

/** Helper: an "all levers off" baseline for a model. */
export function zeroLevers(model: SimModel): ParamValues {
  const out: ParamValues = {};
  for (const l of model.levers) out[l.id] = 0;
  return out;
}

/**
 * The realistic do-nothing baseline: each lever at its EXISTING level (what is
 * already built). For a model with no existing infrastructure this equals
 * {@link zeroLevers}.
 */
export function baselineLevers(model: SimModel): ParamValues {
  const out: ParamValues = {};
  for (const l of model.levers) out[l.id] = model.existing?.[l.id] ?? 0;
  return out;
}

/** Helper: default driver values for a model. */
export function defaultDrivers(model: SimModel): ParamValues {
  const out: ParamValues = {};
  for (const d of model.drivers) out[d.id] = d.default;
  return out;
}

/**
 * Cost of a lever set — only the amount built ABOVE the existing level is
 * charged. The fixed (mobilisation/land) cost applies only when building a lever
 * from scratch (no existing facility); expanding an existing one pays variable
 * cost only.
 */
export function leverCost(model: SimModel, levers: ParamValues): number {
  let total = 0;
  for (const spec of model.levers) {
    const v = levers[spec.id] ?? 0;
    const ex = model.existing?.[spec.id] ?? 0;
    const added = v - ex;
    if (added > 1e-9)
      total += added * spec.costPerUnit + (ex <= 0 ? spec.fixedCost : 0);
  }
  return total;
}
