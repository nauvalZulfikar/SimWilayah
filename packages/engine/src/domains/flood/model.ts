import type {
  ParamSpec,
  ScenarioInput,
  SimModel,
  SimResult,
  Zone,
  ZoneStatus,
} from "../../types";

/**
 * Lumped, hourly water-balance flood model.
 *
 * Each zone is a bucket: rain (and, when the river overtops, river ingress)
 * flows IN; the local drainage network carries water OUT to the river — but
 * ONLY while the river surface sits below the zone's ground level. Once the
 * river rises above the zone (the Tegalluar reality at the Cikeruh–Citarik–
 * Citarum confluence), drainage locks up (backwater) and the bucket fills.
 *
 * It is deliberately simple — not HEC-RAS — but it captures the mechanism that
 * actually drives the flooding and lets each intervention be compared fairly.
 * Every coefficient is exposed in {@link FloodConfig} so it can be recalibrated
 * for any region once real data (DEM, rainfall, discharge) is available.
 */

export interface FloodZoneData {
  id: string;
  name: string;
  x: number;
  y: number;
  area_ha: number;
  /**
   * Ground elevation used BY THE MODEL (metres above sea level).
   * Calibrated to the local floodplain datum — see `srtm_elevation_m` for the
   * raw measured value and why they differ.
   */
  elevation_m: number;
  /** Real coordinates (WGS84) for the georeferenced map. */
  lat?: number;
  lng?: number;
  /**
   * Raw elevation sampled from the SRTM30m DEM at (lat,lng). Shown for
   * transparency only — SRTM's vertical error (~6–16 m) is larger than the
   * flood depths we model, so it is NOT used to drive the simulation.
   */
  srtm_elevation_m?: number;
  households: number;
  /** Depression + network storage before spilling to the surface, as mm of depth. */
  base_storage_mm: number;
  /** Max drainage outflow capacity, as mm/h of depth over the zone. */
  drainage_rate_mm_per_h: number;
  /** Whether a retention pond can be sited here. */
  retention_eligible: boolean;
  /**
   * Observed to have flooded in a recent real event (ground-truth for
   * validation: the model should also flood it under the design storm). Shown in
   * the UI as a calibration check, not used to drive the simulation.
   */
  flooded_observed?: boolean;
}

export interface FloodCoefficients {
  /** River-surface drop (m) per 1 juta m³ of sediment dredged. */
  dredgeLevelPerJuta: number;
  /** Extra drainage conveyance multiplier per 1 juta m³ dredged. */
  dredgeConveyancePerJuta: number;
  /** Drainage multiplier gain at 100% upgrade (drainMult = 1 + pct/100 * gain). */
  drainGainAtFull: number;
  /** Cubic metres of storage added per 1 juta m³ of retention lever. */
  retentionPerJuta_m3: number;
  /** River water that backs INTO a submerged zone, as m/h depth per m of submergence. */
  ingressCoef: number;
  /** Submergence (m) is capped here before driving ingress. */
  ingressCapM: number;
  /** Head (m) over which drainage ramps from 0 to full as the river drops. */
  drainHeadM: number;
  /** Hour at which the river crests within the event. */
  riverPeakHour: number;
  /** Fraction of flooded households shielded at 100% EWS coverage. */
  ewsEffectAtFull: number;
  /** Depth (m) above which a zone counts as flooded / a household impacted. */
  floodThresholdM: number;
  /** Depth (m) above which a zone is "critical". */
  criticalThresholdM: number;
}

export interface FloodConfig {
  id: string;
  title: string;
  description: string;
  zones: FloodZoneData[];
  /** River-surface elevation (m) at the outlet before the event. */
  baseRiverLevel_m: number;
  coef: FloodCoefficients;
  drivers: ParamSpec[];
  levers: ParamSpec[];
  /** Lever amounts already built (existing infrastructure). Optional; default 0. */
  existing?: Record<string, number>;
}

const HA_TO_M2 = 10_000;

/** Triangular river hydrograph: rises to 1.0 at peak hour, recedes after. */
function riverProfile(t: number, duration: number, peak: number): number {
  if (t <= 0) return 0;
  if (t <= peak) return t / peak;
  const tail = duration + peak * 0.5; // gentle recession past the storm
  return Math.max(0, 1 - (t - peak) / (tail - peak));
}

function statusFor(depth: number, coef: FloodCoefficients): ZoneStatus {
  if (depth >= coef.criticalThresholdM) return "critical";
  if (depth >= coef.floodThresholdM) return "warning";
  return "ok";
}

export function createFloodModel(config: FloodConfig): SimModel {
  const zones: Zone[] = config.zones.map((z) => ({
    id: z.id,
    name: z.name,
    x: z.x,
    y: z.y,
    area_m2: z.area_ha * HA_TO_M2,
    attrs: {
      elevation_m: z.elevation_m,
      households: z.households,
      base_storage_mm: z.base_storage_mm,
      drainage_rate_mm_per_h: z.drainage_rate_mm_per_h,
      retention_eligible: z.retention_eligible ? 1 : 0,
      flooded_observed: z.flooded_observed ? 1 : 0,
      lat: z.lat ?? 0,
      lng: z.lng ?? 0,
      srtm_elevation_m: z.srtm_elevation_m ?? 0,
    },
  }));

  function run(input: ScenarioInput): SimResult {
    const c = config.coef;
    const rainMm = input.drivers.rain_mm ?? 0;
    const durationH = Math.max(1, Math.round(input.drivers.duration_h ?? 6));
    const upstreamRise = input.drivers.upstream_rise_m ?? 0;

    const dredge = input.levers.dredge ?? 0; // juta m³
    const retention = input.levers.retention ?? 0; // juta m³
    const drainagePct = input.levers.drainage ?? 0; // %
    const ewsPct = input.levers.ews ?? 0; // %

    const dredgeDrop = dredge * c.dredgeLevelPerJuta;
    const drainMult =
      (1 + (drainagePct / 100) * c.drainGainAtFull) *
      (1 + dredge * c.dredgeConveyancePerJuta);
    const rainIntensityMmH = rainMm / durationH;

    // Distribute retention storage across eligible zones in proportion to area.
    const retentionM3 = retention * c.retentionPerJuta_m3;
    const eligibleArea = config.zones
      .filter((z) => z.retention_eligible)
      .reduce((s, z) => s + z.area_ha * HA_TO_M2, 0);

    // Per-zone running state.
    const state = config.zones.map((z) => {
      const area = z.area_ha * HA_TO_M2;
      const retentionShare =
        z.retention_eligible && eligibleArea > 0
          ? (area / eligibleArea) * retentionM3
          : 0;
      return {
        z,
        area,
        vol: 0, // m³ currently held (drainable + ponded)
        storageCap: (z.base_storage_mm / 1000) * area + retentionShare,
        effDrainagePerH: (z.drainage_rate_mm_per_h / 1000) * area * drainMult,
        peakDepth: 0,
      };
    });

    const timeline: SimResult["timeline"] = [];
    const totalEventHours = durationH + Math.round(c.riverPeakHour * 0.5) + 2;

    for (let t = 1; t <= totalEventHours; t++) {
      const raining = t <= durationH;
      const riverLevel =
        config.baseRiverLevel_m +
        upstreamRise * riverProfile(t, durationH, c.riverPeakHour) -
        dredgeDrop;

      let floodedVolTotal = 0;
      let maxDepth = 0;

      for (const s of state) {
        const elev = s.z.elevation_m;
        const rainVol = raining ? (rainIntensityMmH / 1000) * s.area : 0;
        const submergence = riverLevel - elev;

        let drainOut = 0;
        let riverIngress = 0;
        if (submergence >= 0) {
          // Backwater lock: nothing drains; the swollen river pushes water in.
          const eff = Math.min(submergence, c.ingressCapM);
          riverIngress = eff * c.ingressCoef * s.area;
        } else {
          const head = -submergence; // metres of head available to drain
          const headFactor = Math.min(1, head / c.drainHeadM);
          drainOut = Math.min(
            s.effDrainagePerH * headFactor,
            s.vol + rainVol + riverIngress,
          );
        }

        s.vol = Math.max(0, s.vol + rainVol + riverIngress - drainOut);
        const floodVol = Math.max(0, s.vol - s.storageCap);
        const depth = floodVol / s.area;
        if (depth > s.peakDepth) s.peakDepth = depth;
        floodedVolTotal += floodVol;
        if (depth > maxDepth) maxDepth = depth;
      }

      timeline.push({
        t,
        series: {
          river_level_m: round(riverLevel, 3),
          max_depth_m: round(maxDepth, 3),
          flooded_volume_m3: Math.round(floodedVolTotal),
        },
      });
    }

    // ---- Aggregate KPIs ----
    let floodedAreaHa = 0;
    let householdsFlooded = 0;
    let peakDepthMax = 0;
    const zoneOutcomes = state.map((s) => {
      const depth = s.peakDepth;
      if (depth >= c.floodThresholdM) {
        floodedAreaHa += s.z.area_ha;
        householdsFlooded += s.z.households;
      }
      if (depth > peakDepthMax) peakDepthMax = depth;
      return {
        zoneId: s.z.id,
        severity: round(depth, 3),
        status: statusFor(depth, c),
        detail: {
          peak_depth_m: round(depth, 3),
          households: s.z.households,
          elevation_m: s.z.elevation_m,
          storage_m3: Math.round(s.storageCap),
        },
      };
    });

    const householdsNoWarning = Math.round(
      householdsFlooded * (1 - (ewsPct / 100) * c.ewsEffectAtFull),
    );

    // Only the build ABOVE the existing level is charged (fixed cost only when
    // building from scratch). Mirrors leverCost() in the generic core.
    let totalCost = 0;
    for (const spec of config.levers) {
      const v = input.levers[spec.id] ?? 0;
      const ex = config.existing?.[spec.id] ?? 0;
      const added = v - ex;
      if (added > 1e-9)
        totalCost += added * spec.costPerUnit + (ex <= 0 ? spec.fixedCost : 0);
    }

    const kpis = [
      {
        id: "households_flooded",
        label: "Rumah terendam",
        value: householdsFlooded,
        unit: "rumah",
        betterWhenLower: true,
      },
      {
        id: "households_no_warning",
        label: "Rumah tanpa peringatan dini",
        value: householdsNoWarning,
        unit: "rumah",
        betterWhenLower: true,
      },
      {
        id: "flooded_area_ha",
        label: "Luas area terendam",
        value: round(floodedAreaHa, 1),
        unit: "ha",
        betterWhenLower: true,
      },
      {
        id: "peak_depth_m",
        label: "Kedalaman banjir puncak",
        value: round(peakDepthMax, 2),
        unit: "m",
        betterWhenLower: true,
      },
    ];

    return { kpis, zones: zoneOutcomes, timeline, totalCost };
  }

  return {
    id: config.id,
    title: config.title,
    description: config.description,
    zones,
    levers: config.levers,
    existing: config.existing ?? {},
    drivers: config.drivers,
    primaryKpiId: "households_flooded",
    severityLabel: "Kedalaman (m)",
    run,
  };
}

function round(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}
