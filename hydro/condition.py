"""Tahap 3a — hydrologic conditioning: stream-burn + inlet/outlet placement.

Coarsens the DEM, then BURNS the real river network (from the web app's
sungai geojson) into it so water has a connected channel from the upstream
inlet (Citarum entering SE) to the basin outlet (Citarum exiting toward
Nanjung, W). Inflow is injected into the channel, not an arbitrary low cell.

We deliberately do NOT fill the basin depression (it is real flood storage);
we only carve channels + remove 1-cell artefact pits.

Output: data/grid.npz  (z, dx, bounds, outlet, inlet, channel masks, zone idx)
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import rasterize

HERE = Path(__file__).parent
DEM = HERE / "data" / "dem_aoi.tif"
GEO = HERE.parent / "apps" / "web" / "public" / "geo" / "sungai-kab-bandung.geojson"
OUT = HERE / "data" / "grid.npz"

COARSEN = 3  # 31 m -> ~92 m

# Burn depth (m) by river class — deeper trunk channels route more strongly.
BURN = {"major": 5.0, "river": 3.0, "canal": 2.0}

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
    ny, nx = a.shape
    ny2, nx2 = (ny // k) * k, (nx // k) * k
    return a[:ny2, :nx2].reshape(ny2 // k, k, nx2 // k, k).mean(axis=(1, 3))


def main():
    with rasterio.open(DEM) as src:
        z0 = src.read(1).astype(np.float64)
        b = src.bounds
        fine_tr = src.transform
    z0 = np.where(np.isfinite(z0) & (z0 > 0), z0, np.nanmedian(z0[z0 > 0]))
    z = _block_mean(z0, COARSEN)
    ny, nx = z.shape
    # coarse affine transform
    from rasterio.transform import from_bounds as tr_from_bounds
    tr = tr_from_bounds(b.left, b.bottom, b.right, b.top, nx, ny)
    mid_lat = (b.bottom + b.top) / 2
    dx = abs(fine_tr.a) * COARSEN * 111_320 * np.cos(np.radians(mid_lat))

    feats = json.load(open(GEO))["features"]

    def burn_mask(classes):
        geoms = [
            (f["geometry"], 1)
            for f in feats
            if f["properties"].get("cls") in classes
            and f["geometry"]["type"] in ("LineString", "MultiLineString")
        ]
        if not geoms:
            return np.zeros((ny, nx), bool)
        r = rasterize(geoms, out_shape=(ny, nx), transform=tr, fill=0,
                      all_touched=True, dtype="uint8")
        return r.astype(bool)

    channel = np.zeros((ny, nx), bool)
    for cls, depth in BURN.items():
        m = burn_mask({cls})
        z[m] -= depth
        channel |= m
    # smooth single-cell artefact spikes (median-ish) away from channels
    print(f"channels burned: {int(channel.sum())} cells "
          f"({channel.sum()/channel.size*100:.0f}% of grid)")

    # --- find Citarum entry (inlet) and exit (outlet) on the AOI boundary ---
    def citarum_points():
        pts = []
        for f in feats:
            lab = (f["properties"].get("label") or "").lower()
            if "tarum" not in lab:
                continue
            g = f["geometry"]
            lines = (g["coordinates"] if g["type"] == "MultiLineString"
                     else [g["coordinates"]])
            for line in lines:
                for x, y in line:
                    pts.append((x, y))
        return pts

    cit = citarum_points()
    # boundary-touching Citarum vertices -> classify by side
    inlet = np.zeros((ny, nx), bool)
    outlet = np.zeros((ny, nx), bool)
    margin = 0.01  # deg
    for x, y in cit:
        near_w = x < b.left + margin
        near_e = x > b.right - margin
        near_s = y < b.bottom + margin
        near_n = y > b.top - margin
        if not (near_w or near_e or near_s or near_n):
            continue
        col = int((x - b.left) / (b.right - b.left) * (nx - 1))
        row = int((b.top - y) / (b.top - b.bottom) * (ny - 1))
        col = min(max(col, 0), nx - 1)
        row = min(max(row, 0), ny - 1)
        # Citarum flows E/SE -> W/NW; entry on E/S side, exit on W/N side
        if near_e or near_s:
            inlet[row, col] = True
        if near_w or near_n:
            outlet[row, col] = True

    # widen I/O a touch along the channel near those points
    def dilate(mask, r=1):
        out = mask.copy()
        idx = np.argwhere(mask)
        for rr, cc in idx:
            out[max(0, rr - r):rr + r + 1, max(0, cc - r):cc + r + 1] = True
        return out & channel

    inlet = dilate(inlet, 2)
    outlet = dilate(outlet, 2)
    # Fallback: if Citarum boundary detection is thin, anchor outlet to the
    # lowest channel cell on the west third, inlet to lowest channel on east.
    if inlet.sum() < 2:
        ch = np.argwhere(channel & (np.arange(nx)[None, :] > nx * 2 // 3))
        if len(ch):
            r0, c0 = ch[np.argmin([z[r, c] for r, c in ch])]
            inlet[r0, c0] = True
    if outlet.sum() < 2:
        ch = np.argwhere(channel & (np.arange(nx)[None, :] < nx // 3))
        if len(ch):
            r0, c0 = ch[np.argmin([z[r, c] for r, c in ch])]
            outlet[r0, c0] = True

    print(f"inlet cells: {int(inlet.sum())}  outlet cells: {int(outlet.sum())}")

    # zone pixel indices
    zone_rc = {}
    for name, (x, y) in ZONES.items():
        col = int((x - b.left) / (b.right - b.left) * (nx - 1))
        row = int((b.top - y) / (b.top - b.bottom) * (ny - 1))
        zone_rc[name] = (row, col)

    np.savez(
        OUT, z=z, dx=dx, bounds=np.array([b.left, b.bottom, b.right, b.top]),
        outlet=outlet, inlet=inlet, channel=channel,
        zone_names=np.array(list(zone_rc.keys())),
        zone_rc=np.array(list(zone_rc.values())),
    )
    print(f"[saved] {OUT}  grid {nx}x{ny}  dx={dx:.1f}m")
    print("zone elevations (conditioned):")
    for name, (r, c) in sorted(zone_rc.items(), key=lambda kv: z[kv[1]]):
        tag = " [channel]" if channel[r, c] else ""
        print(f"  {z[r, c]:7.1f}  {name}{tag}")


if __name__ == "__main__":
    main()
