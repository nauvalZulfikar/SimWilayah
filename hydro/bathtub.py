"""Tahap 3 (revised) — volume-on-real-terrain flood model (bathtub / level-pool).

Honest given available data: we do NOT have surveyed river bathymetry, so a full
2D hydrodynamic placement of overbank flow is under-determined. Instead we use
the real DEM the way rapid flood-hazard mapping does:

  1. a lumped water balance gives the flood VOLUME trapped in the basin
     V = rain_excess + upstream_inflow - outlet_capacity*t - infiltration - retention
  2. that volume is poured into the real DEM depression (Cekungan Bandung
     Selatan), filling to a water level L; per-cell depth = max(0, L - z).

This uses the actual terrain (the valuable data we acquired), is calibratable
to the 2026 flood, runs in milliseconds, and maps cleanly onto SimWilayah's
levers. The 2D solver (solver.py) stays as the Jalan-B upgrade for when BBWS
cross-sections arrive.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from scipy import ndimage

HERE = Path(__file__).parent
DEM = HERE / "data" / "dem_aoi.tif"
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)

COARSEN = 2  # 31 m -> ~62 m (bathtub is cheap; keep decent detail)

ZONES = {
    "muara": (107.640, -6.998),
    "dayeuhkolot": (107.617, -6.988),
    "baleendah": (107.607, -7.010),
    "bojongsoang": (107.638, -6.975),
    "tegalluar": (107.690, -6.972),
    "sapan": (107.700, -6.985),
    "stasiun": (107.660, -6.970),
    "panyileukan": (107.715, -6.945),
}


def _block_mean(a, k):
    if k <= 1:
        return a
    ny, nx = a.shape
    ny2, nx2 = (ny // k) * k, (nx // k) * k
    return a[:ny2, :nx2].reshape(ny2 // k, k, nx2 // k, k).mean(axis=(1, 3))


@dataclass
class Basin:
    z: np.ndarray
    mask: np.ndarray      # cells belonging to the fillable bowl
    dx: float
    bounds: tuple
    zone_rc: dict
    rim: float            # outlet sill elevation (water above this escapes)


def load_basin(rim_max: float = 678.0) -> Basin:
    with rasterio.open(DEM) as src:
        z = src.read(1).astype(np.float64)
        b = src.bounds
        fine_dx = abs(src.transform.a)
    z = np.where(np.isfinite(z) & (z > 0), z, np.nanmedian(z[z > 0]))
    z = _block_mean(z, COARSEN)
    ny, nx = z.shape
    mid_lat = (b.bottom + b.top) / 2
    dx = fine_dx * COARSEN * 111_320 * np.cos(np.radians(mid_lat))

    # Bowl = connected low region (below rim_max) containing the global minimum.
    low = z < rim_max
    lbl, _ = ndimage.label(low)
    rmin, cmin = np.unravel_index(np.argmin(z), z.shape)
    bowl = lbl == lbl[rmin, cmin]

    # Copernicus is a DSM (includes buildings/levees). A zone's flood depth is
    # governed by the low GROUND where water sits, so take the local minimum in
    # a ~250 m window as the representative bare-earth elevation.
    win = max(1, int(250 / dx))
    z_min = ndimage.minimum_filter(z, size=2 * win + 1)
    zone_rc = {}
    zone_z = {}
    for name, (x, y) in ZONES.items():
        col = int((x - b.left) / (b.right - b.left) * (nx - 1))
        row = int((b.top - y) / (b.top - b.bottom) * (ny - 1))
        row, col = min(max(row, 0), ny - 1), min(max(col, 0), nx - 1)
        zone_rc[name] = (row, col)
        zone_z[name] = float(z_min[row, col])

    basin = Basin(z=z, mask=bowl, dx=dx,
                  bounds=(b.left, b.bottom, b.right, b.top),
                  zone_rc=zone_rc, rim=rim_max)
    basin.zone_z = zone_z  # type: ignore[attr-defined]
    return basin


def level_for_volume(basin: Basin, volume_m3: float) -> float:
    """Water level L such that sum(max(0, L - z) * area) over the bowl = V."""
    z = basin.z[basin.mask]
    area = basin.dx ** 2
    if volume_m3 <= 0:
        return float(z.min())
    lo, hi = z.min(), basin.rim + 5.0
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        vol = np.maximum(mid - z, 0.0).sum() * area
        if vol < volume_m3:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def flood(basin: Basin, volume_m3: float):
    L = level_for_volume(basin, volume_m3)
    depth = np.where(basin.mask, np.maximum(L - basin.z, 0.0), 0.0)
    return L, depth


def stats(basin: Basin, depth: np.ndarray, L: float, thr=0.30, radius_m=400.0):
    flooded = depth > thr
    area_ha = flooded.sum() * basin.dx ** 2 / 1e4
    # Per-zone depth = neighbourhood flood, not a single noisy DSM pixel.
    # Average the inundation over cells within `radius` of the zone centre, and
    # clip the deepest 10% (channel bed) so the value reflects the streets, not
    # the river. A zone "floods" when a meaningful share of its area is wet.
    ny, nx = depth.shape
    rad = max(1, int(radius_m / basin.dx))
    zone_depth = {}
    zone_wetfrac = {}
    for n, (r, c) in basin.zone_rc.items():
        r0, r1 = max(0, r - rad), min(ny, r + rad + 1)
        c0, c1 = max(0, c - rad), min(nx, c + rad + 1)
        patch = depth[r0:r1, c0:c1]
        wet = patch[patch > 0.05]
        if wet.size:
            cap = np.percentile(wet, 90)  # drop channel-bed outliers
            zone_depth[n] = float(np.clip(wet, 0, cap).mean())
            zone_wetfrac[n] = float((patch > thr).mean())
        else:
            zone_depth[n] = 0.0
            zone_wetfrac[n] = 0.0
    d_plain = depth[flooded]
    p97 = np.percentile(depth[depth > 0.05], 97) if (depth > 0.05).any() else 0.0
    return dict(area_ha=area_ha, max_depth=float(p97),
                mean_depth=float(d_plain.mean()) if flooded.any() else 0.0,
                zone_depth=zone_depth, zone_wetfrac=zone_wetfrac)


# ---- lumped flood-volume model (this is what SimWilayah's engine computes) ----
@dataclass
class Forcing:
    rain_mm: float = 95.0
    duration_h: float = 6.0
    upstream_m3s: float = 150.0    # Citarum inflow at basin head during storm
    outlet_cap_m3s: float = 230.0  # Nanjung tunnel + floodway
    retention_Mm3: float = 0.0     # existing+new retention storage removed
    infil_mm: float = 25.0         # storm-total losses (infiltration+drainage)
    catchment_km2: float = 380.0   # upstream catchment feeding the basin head


def flood_volume(basin: Basin, f: Forcing) -> float:
    """Net volume trapped in the bowl during the storm (m^3)."""
    storm_s = f.duration_h * 3600.0
    area_bowl = basin.mask.sum() * basin.dx ** 2
    # direct rain on the bowl floodplain, minus losses
    rain_net = max(f.rain_mm - f.infil_mm, 0.0) / 1000.0 * area_bowl
    # upstream inflow over the storm (regional rivers into the basin head)
    inflow = f.upstream_m3s * storm_s
    # what the outlet can evacuate during the storm
    evac = f.outlet_cap_m3s * storm_s
    # retention basins remove storage
    ret = f.retention_Mm3 * 1e6
    V = rain_net + inflow - evac - ret
    return max(V, 0.0)


def _smoke():
    basin = load_basin()
    print(f"grid {basin.z.shape[1]}x{basin.z.shape[0]}  dx={basin.dx:.1f}m  "
          f"bowl={int(basin.mask.sum())} cells "
          f"({basin.mask.sum()*basin.dx**2/1e6:.0f} km2)  rim={basin.rim}")
    for name, f in [
        ("biasa Q2", Forcing(rain_mm=70, duration_h=6, upstream_m3s=110)),
        ("Q5", Forcing(rain_mm=95, duration_h=6, upstream_m3s=150)),
        ("Q25", Forcing(rain_mm=140, duration_h=8, upstream_m3s=210)),
        ("ekstrem 2026", Forcing(rain_mm=180, duration_h=10, upstream_m3s=260)),
    ]:
        V = flood_volume(basin, f)
        L, depth = flood(basin, V)
        s = stats(basin, depth, L)
        print(f"\n[{name}] V={V/1e6:.1f}Mm3  L={L:.1f}mdpl  "
              f"area={s['area_ha']:.0f}ha  maxplain={s['max_depth']:.2f}m")
        for n, d in sorted(s["zone_depth"].items(), key=lambda kv: -kv[1]):
            wf = s["zone_wetfrac"][n]
            print(f"    {d:5.2f} m  ({wf*100:3.0f}% area)  {n}"
                  f"{'  FLOOD' if d > 0.3 else ''}")
        last = (name, depth)

    # map of the extreme scenario
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    nm, depth = last
    bl, bb, br, bt = basin.bounds
    fig, ax = plt.subplots(figsize=(8, 6))
    ax.imshow(basin.z, cmap="gray", extent=[bl, br, bb, bt])
    d = np.where(depth > 0.05, depth, np.nan)
    im = ax.imshow(d, cmap="Blues", vmin=0, vmax=2.5, extent=[bl, br, bb, bt])
    for n, (r, c) in basin.zone_rc.items():
        x = bl + (c + 0.5) / basin.z.shape[1] * (br - bl)
        y = bt - (r + 0.5) / basin.z.shape[0] * (bt - bb)
        ax.plot(x, y, "o", ms=4, color="red")
        ax.annotate(n, (x, y), fontsize=6, color="darkred",
                    xytext=(2, 2), textcoords="offset points")
    plt.colorbar(im, ax=ax, label="kedalaman (m)", shrink=0.7)
    ax.set_title(f"Genangan [{nm}] — bathtub di DEM asli (Copernicus 30m)")
    fig.savefig(OUT / "flood_bathtub.png", dpi=130, bbox_inches="tight")
    print(f"\n[viz] {OUT/'flood_bathtub.png'}")


if __name__ == "__main__":
    _smoke()
