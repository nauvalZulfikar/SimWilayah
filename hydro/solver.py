"""Tahap 2 — 2D inertial shallow-water solver (LISFLOOD-FP class).

Bates, Horritt & Fewtrell (2010) inertial formulation on the DEM raster.
Forcing = spatially-uniform rainfall (design storm) + optional upstream inflow
at the SE inlet. Water leaves through a capacity-capped outlet at Nanjung (W),
which is how the basin's topographic trap is represented physically.

This file is the engine. Lever effects + calibration + scenario sweep build on
top of `simulate()`. Run directly for a smoke test (mass balance + flood map).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import rasterio
from numba import njit

HERE = Path(__file__).parent
DEM = HERE / "data" / "dem_aoi.tif"
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)

G = 9.81
HFLOW_MIN = 0.005  # m — below this a face is dry, no flux
MANNING = 0.045  # floodplain roughness (mixed urban/paddy)


@dataclass
class Forcing:
    rain_mm: float = 95.0          # total storm depth
    duration_h: float = 6.0        # storm duration
    upstream_m3s: float = 0.0      # steady inflow at SE inlet (regional rivers)
    outlet_cap_m3s: float = 230.0  # Nanjung tunnel + floodway capacity
    sim_hours: float = 18.0        # total simulated time (storm + recession)
    infiltration_mm_h: float = 2.0  # baseline loss


@dataclass
class Grid:
    z: np.ndarray          # bed elevation (m)
    dx: float              # cell size (m)
    transform: object
    outlet: np.ndarray     # bool mask of outlet cells (W edge, low)
    inlet: np.ndarray      # bool mask of inlet cells (SE edge, low)
    meta: dict = field(default_factory=dict)


def _block_mean(a: np.ndarray, k: int) -> np.ndarray:
    if k <= 1:
        return a
    ny, nx = a.shape
    ny2, nx2 = (ny // k) * k, (nx // k) * k
    return a[:ny2, :nx2].reshape(ny2 // k, k, nx2 // k, k).mean(axis=(1, 3))


GRID_NPZ = HERE / "data" / "grid.npz"


def load_conditioned() -> Grid:
    """Load the stream-burned, I/O-tagged grid from condition.py."""
    d = np.load(GRID_NPZ, allow_pickle=True)
    z = d["z"].astype(np.float64)
    names = list(d["zone_names"])
    rc = d["zone_rc"]
    zones = {str(n): (int(rc[i][0]), int(rc[i][1])) for i, n in enumerate(names)}
    b = d["bounds"]
    return Grid(z=z, dx=float(d["dx"]), transform=None,
               outlet=d["outlet"], inlet=d["inlet"],
               meta=dict(ny=z.shape[0], nx=z.shape[1],
                         bounds=tuple(b), zones=zones,
                         channel=d["channel"]))


def load_grid(coarsen: int = 3) -> Grid:
    if GRID_NPZ.exists():
        return load_conditioned()
    with rasterio.open(DEM) as src:
        z = src.read(1).astype(np.float64)
        tr = src.transform
        mid_lat = (src.bounds.bottom + src.bounds.top) / 2
        dx = abs(tr.a) * 111_320 * np.cos(np.radians(mid_lat))
    # Fill obvious nodata / spikes, then coarsen for tractable basin-scale runs.
    z = np.where(np.isfinite(z) & (z > 0), z, np.nanmedian(z[z > 0]))
    z = _block_mean(z, coarsen)
    dx = dx * coarsen
    ny, nx = z.shape

    floor = np.percentile(z, 8)  # basin-floor river level
    outlet = np.zeros_like(z, dtype=bool)
    inlet = np.zeros_like(z, dtype=bool)
    # Outlet: west edge, low cells (Citarum exit toward Nanjung/Curug).
    outlet[:, :3] |= z[:, :3] < floor + 6
    # Inlet: south + east edge low cells (Citarum/Cikeruh/Citarik come in here).
    inlet[-3:, :] |= z[-3:, :] < floor + 8
    inlet[:, -3:] |= z[:, -3:] < floor + 8
    return Grid(z=z, dx=dx, transform=tr, outlet=outlet, inlet=inlet,
               meta=dict(ny=ny, nx=nx, floor=float(floor)))


@njit(cache=True, fastmath=True)
def _step(z, h, qx, qy, dx, dt, n2, outlet, inlet, rain_ms, infil_ms, inflow_ms):
    ny, nx = z.shape
    # --- x-faces (between col j and j+1) ---
    for i in range(ny):
        for j in range(nx - 1):
            eta1 = z[i, j] + h[i, j]
            eta2 = z[i, j + 1] + h[i, j + 1]
            hflow = max(eta1, eta2) - max(z[i, j], z[i, j + 1])
            if hflow <= HFLOW_MIN:
                qx[i, j] = 0.0
                continue
            sf = (eta2 - eta1) / dx
            q = qx[i, j]
            q = (q - G * hflow * dt * sf) / (
                1.0 + G * dt * n2 * abs(q) / hflow ** (7.0 / 3.0)
            )
            # positivity limiter: a donor cell (area dx^2) may shed at most
            # 0.2*h per face per step -> with 4 faces, h stays >= 0 (no clamp,
            # no spurious mass). Limit is depth-moved q*dt/dx <= 0.2*h_donor.
            if q > 0.0:
                qmax = 0.2 * h[i, j] * dx / dt
                if q > qmax:
                    q = qmax
            else:
                qmax = 0.2 * h[i, j + 1] * dx / dt
                if -q > qmax:
                    q = -qmax
            qx[i, j] = q
    # --- y-faces (between row i and i+1) ---
    for i in range(ny - 1):
        for j in range(nx):
            eta1 = z[i, j] + h[i, j]
            eta2 = z[i + 1, j] + h[i + 1, j]
            hflow = max(eta1, eta2) - max(z[i, j], z[i + 1, j])
            if hflow <= HFLOW_MIN:
                qy[i, j] = 0.0
                continue
            sf = (eta2 - eta1) / dx
            q = qy[i, j]
            q = (q - G * hflow * dt * sf) / (
                1.0 + G * dt * n2 * abs(q) / hflow ** (7.0 / 3.0)
            )
            if q > 0.0:
                qmax = 0.2 * h[i, j] * dx / dt
                if q > qmax:
                    q = qmax
            else:
                qmax = 0.2 * h[i + 1, j] * dx / dt
                if -q > qmax:
                    q = -qmax
            qy[i, j] = q
    # --- depth update (per unit width q -> volume) + exact water budget ---
    cell_a = dx * dx
    rain_added = 0.0
    infil_removed = 0.0
    inflow_added = 0.0
    for i in range(ny):
        for j in range(nx):
            qin = 0.0
            if j > 0:
                qin += qx[i, j - 1]
            if j < nx - 1:
                qin -= qx[i, j]
            if i > 0:
                qin += qy[i - 1, j]
            if i < ny - 1:
                qin -= qy[i, j]
            h[i, j] += dt / dx * qin
            # rainfall on every cell
            if rain_ms > 0.0:
                h[i, j] += rain_ms * dt
                rain_added += rain_ms * dt * cell_a
            # upstream inflow at inlet cells
            if inlet[i, j] and inflow_ms > 0.0:
                h[i, j] += inflow_ms * dt
                inflow_added += inflow_ms * dt * cell_a
            # infiltration only from wet cells (can't go below zero)
            if h[i, j] > 0.0:
                loss = infil_ms * dt
                if loss > h[i, j]:
                    loss = h[i, j]
                h[i, j] -= loss
                infil_removed += loss * cell_a
    return rain_added, infil_removed, inflow_added


@njit(cache=True, fastmath=True)
def _drain_outlet(h, z, outlet, dx, dt, cap_vol):
    # Free outflow at outlet cells, total volume this step capped at cap_vol.
    ny, nx = z.shape
    avail = 0.0
    for i in range(ny):
        for j in range(nx):
            if outlet[i, j] and h[i, j] > 0.0:
                avail += h[i, j] * dx * dx
    if avail <= 0.0:
        return 0.0
    take = min(avail, cap_vol)
    frac = take / avail
    for i in range(ny):
        for j in range(nx):
            if outlet[i, j]:
                h[i, j] *= (1.0 - frac)
    return take


def simulate(grid: Grid, f: Forcing, lever_field: np.ndarray | None = None,
             record_peak=True, verbose=False):
    z = grid.z.copy()
    if lever_field is not None:
        z = z + lever_field  # negative = dredged/lowered channel
    ny, nx = z.shape
    dx = grid.dx
    h = np.zeros_like(z)
    qx = np.zeros((ny, nx), np.float64)
    qy = np.zeros((ny, nx), np.float64)
    n2 = MANNING ** 2

    peak = np.zeros_like(z) if record_peak else None
    T = f.sim_hours * 3600.0
    storm_T = f.duration_h * 3600.0
    rain_total_ms = (f.rain_mm / 1000.0) / storm_T  # m/s during storm
    infil_ms = (f.infiltration_mm_h / 1000.0) / 3600.0
    n_inlet = max(1, int(grid.inlet.sum()))
    inflow_ms = f.upstream_m3s / (n_inlet * dx * dx)  # spread over inlet cells

    t = 0.0
    rain_vol = inflow_vol = infil_vol = out_vol = 0.0
    nsteps = 0
    next_report = 0.1
    while t < T:
        hmax = h.max()
        if verbose and t / T >= next_report:
            print(f"    {t/T*100:3.0f}%  t={t/3600:.1f}h  hmax={hmax:.2f}m  "
                  f"steps={nsteps}", flush=True)
            next_report += 0.2
        dt = 0.5 * dx / np.sqrt(G * max(hmax, 0.05))
        dt = min(dt, 5.0)
        rain_ms = rain_total_ms if t < storm_T else 0.0
        inflow_now = inflow_ms if t < storm_T * 1.5 else 0.0
        ra, ir, ia = _step(z, h, qx, qy, dx, dt, n2, grid.outlet, grid.inlet,
                           rain_ms, infil_ms, inflow_now)
        rain_vol += ra
        infil_vol += ir
        inflow_vol += ia
        out_vol += _drain_outlet(h, z, grid.outlet, dx, dt, f.outlet_cap_m3s * dt)
        if record_peak:
            np.maximum(peak, h, out=peak)
        t += dt
        nsteps += 1

    stored = (h * dx * dx).sum()
    inp = rain_vol + inflow_vol
    bal = inp - infil_vol - out_vol - stored
    if verbose:
        print(f"  steps={nsteps} dt~{dt:.1f}s | in(rain {rain_vol/1e6:.1f} + "
              f"flow {inflow_vol/1e6:.1f})={inp/1e6:.1f}  infil={infil_vol/1e6:.1f}  "
              f"out={out_vol/1e6:.2f}  stored={stored/1e6:.1f} Mm3  "
              f"resid={bal/max(inp,1)*100:+.1f}%")
    return dict(h=h, peak=peak if record_peak else h, out_vol=out_vol,
                rain_vol=rain_vol, inflow_vol=inflow_vol, infil_vol=infil_vol,
                stored=stored, balance_pct=bal / max(inp, 1) * 100, nsteps=nsteps)


def flood_stats(grid: Grid, peak: np.ndarray, thr=0.30):
    # Flood extent = floodplain only (burned river channels are always wet and
    # are not "banjir permukiman"), measured above threshold.
    ch = grid.meta.get("channel")
    plain = peak > thr
    if ch is not None:
        plain = plain & ~ch
    area_ha = plain.sum() * (grid.dx ** 2) / 1e4
    zones = grid.meta.get("zones", {})
    zone_depth = {n: float(peak[r, c]) for n, (r, c) in zones.items()}
    return dict(area_ha=area_ha, max_depth=float(peak[~(ch if ch is not None else 0)].max())
                if ch is not None else float(peak.max()),
                mean_depth=float(peak[plain].mean()) if plain.any() else 0.0,
                zone_depth=zone_depth)


def _smoke():
    g = load_grid()
    print(f"grid {g.meta['nx']}x{g.meta['ny']}  dx={g.dx:.1f}m  "
          f"outlet={int(g.outlet.sum())} cells  inlet={int(g.inlet.sum())} cells")
    f = Forcing(rain_mm=95, duration_h=6, upstream_m3s=120, sim_hours=18)
    print("running design storm (Q5-ish): rain95/6h + 120 m3/s upstream ...")
    r = simulate(g, f, verbose=True)
    s = flood_stats(g, r["peak"])
    print(f"FLOOD (floodplain): area>0.30m = {s['area_ha']:.0f} ha  "
          f"max {s['max_depth']:.2f} m  mean {s['mean_depth']:.2f} m")
    print("ZONE peak depth (m):")
    for n, d in sorted(s["zone_depth"].items(), key=lambda kv: -kv[1]):
        flag = "  FLOOD" if d > 0.3 else ""
        print(f"  {d:5.2f}  {n}{flag}")

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    with rasterio.open(DEM) as src:
        b = src.bounds
    fig, ax = plt.subplots(figsize=(8, 6))
    ax.imshow(g.z, cmap="gray", extent=[b.left, b.right, b.bottom, b.top])
    d = np.where(r["peak"] > 0.05, r["peak"], np.nan)
    im = ax.imshow(d, cmap="Blues", vmin=0, vmax=2.5,
                   extent=[b.left, b.right, b.bottom, b.top])
    plt.colorbar(im, ax=ax, label="kedalaman puncak (m)", shrink=0.7)
    ax.set_title("Smoke test — genangan puncak (fisika 2D, DEM asli)")
    fig.savefig(OUT / "flood_smoke.png", dpi=130, bbox_inches="tight")
    print(f"[viz] {OUT/'flood_smoke.png'}")


if __name__ == "__main__":
    _smoke()
