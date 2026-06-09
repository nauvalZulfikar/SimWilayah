"""Tahap 1 — acquire real terrain for Cekungan Bandung Selatan.

Source: Copernicus GLO-30 DSM (30 m, public, no auth) on AWS Open Data.
Tile S07/E107 covers lat -7..-6, lon 107..108 — the whole basin.

Outputs:
  data/raw/<tile>.tif      full 1x1 deg tile (cached)
  data/dem_aoi.tif         clipped to AOI, the model terrain
  out/hillshade.png        visual sanity check
Prints elevation stats + samples at known flood zones so we can confirm the
"bowl" is real (Dayeuhkolot/Baleendah should sit near the low point).
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import rasterio
import requests
from rasterio.merge import merge
from rasterio.windows import from_bounds

HERE = Path(__file__).parent
RAW = HERE / "data" / "raw"
DATA = HERE / "data"
OUT = HERE / "out"
for d in (RAW, DATA, OUT):
    d.mkdir(parents=True, exist_ok=True)

# The basin straddles lat -7.0, so we need two 1x1 deg tiles (S07 + S08).
TILES = [
    "Copernicus_DSM_COG_10_S07_00_E107_00_DEM",
    "Copernicus_DSM_COG_10_S08_00_E107_00_DEM",
]
BASE = "https://copernicus-dem-30m.s3.amazonaws.com"
MOSAIC_PATH = RAW / "mosaic_e107.tif"

# AOI: Cekungan Bandung Selatan (the bowl) — lon/lat WGS84.
AOI = dict(west=107.55, east=107.78, south=-7.06, north=-6.92)

# Reference points (lon, lat) to sanity-check the terrain.
ZONES = {
    "Dayeuhkolot": (107.617, -6.988),
    "Baleendah": (107.607, -7.010),
    "Bojongsoang": (107.638, -6.975),
    "Tegalluar": (107.690, -6.972),
    "Sapan": (107.700, -6.985),
    "Nanjung (outlet)": (107.555, -6.945),
}


def download_tiles() -> list[Path]:
    paths = []
    for tile in TILES:
        p = RAW / f"{tile}.tif"
        paths.append(p)
        if p.exists() and p.stat().st_size > 1_000_000:
            print(f"[cache] {p.name} ({p.stat().st_size/1e6:.1f} MB)")
            continue
        url = f"{BASE}/{tile}/{tile}.tif"
        print(f"[download] {tile}")
        with requests.get(url, stream=True, timeout=180) as r:
            r.raise_for_status()
            with open(p, "wb") as f:
                for chunk in r.iter_content(chunk_size=1 << 20):
                    f.write(chunk)
        print(f"[done] {p.stat().st_size/1e6:.1f} MB")
    return paths


def mosaic(paths: list[Path]) -> None:
    srcs = [rasterio.open(p) for p in paths]
    arr, tr = merge(srcs)
    prof = srcs[0].profile.copy()
    prof.update(height=arr.shape[1], width=arr.shape[2], transform=tr, compress="deflate")
    with rasterio.open(MOSAIC_PATH, "w", **prof) as dst:
        dst.write(arr)
    for s in srcs:
        s.close()


def clip_aoi() -> Path:
    with rasterio.open(MOSAIC_PATH) as src:
        win = from_bounds(
            AOI["west"], AOI["south"], AOI["east"], AOI["north"], src.transform
        )
        data = src.read(1, window=win)
        transform = src.window_transform(win)
        profile = src.profile.copy()
        profile.update(
            height=data.shape[0],
            width=data.shape[1],
            transform=transform,
            compress="deflate",
        )
        out = DATA / "dem_aoi.tif"
        with rasterio.open(out, "w", **profile) as dst:
            dst.write(data, 1)
    return out


def hillshade(z: np.ndarray, az=315.0, alt=45.0) -> np.ndarray:
    az_r, alt_r = np.radians(az), np.radians(alt)
    gy, gx = np.gradient(z)
    slope = np.pi / 2 - np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    sh = np.sin(alt_r) * np.sin(slope) + np.cos(alt_r) * np.cos(slope) * np.cos(
        az_r - aspect
    )
    return np.clip(sh, 0, 1)


def main() -> None:
    paths = download_tiles()
    mosaic(paths)
    out = clip_aoi()
    with rasterio.open(out) as src:
        z = src.read(1).astype("float64")
        tr = src.transform
        res_x = tr.a * 111_320 * np.cos(np.radians((AOI["south"] + AOI["north"]) / 2))
        res_y = -tr.e * 110_540
        print("\n=== TERRAIN (Copernicus GLO-30, clipped) ===")
        print(f"grid       : {z.shape[1]} x {z.shape[0]} px")
        print(f"resolution : ~{res_x:.0f} m x {res_y:.0f} m per pixel")
        print(
            f"elevation  : min {z.min():.1f}  max {z.max():.1f}  "
            f"mean {z.mean():.1f}  mdpl"
        )

        print("\n=== ZONE ELEVATIONS (lower = floods first) ===")
        rows = []
        for name, (lon, lat) in ZONES.items():
            r, c = src.index(lon, lat)
            if 0 <= r < z.shape[0] and 0 <= c < z.shape[1]:
                rows.append((z[r, c], name))
        for elev, name in sorted(rows):
            print(f"  {elev:7.1f} mdpl   {name}")

    hs = hillshade(z)
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(8, 6))
    ax.imshow(hs, cmap="gray", extent=[AOI["west"], AOI["east"], AOI["south"], AOI["north"]])
    im = ax.imshow(
        np.where(z > 0, z, np.nan),
        cmap="terrain",
        alpha=0.45,
        extent=[AOI["west"], AOI["east"], AOI["south"], AOI["north"]],
    )
    for name, (lon, lat) in ZONES.items():
        ax.plot(lon, lat, "o", ms=4, color="red")
        ax.annotate(name, (lon, lat), fontsize=6, color="darkred", xytext=(2, 2), textcoords="offset points")
    plt.colorbar(im, ax=ax, label="mdpl", shrink=0.7)
    ax.set_title("Cekungan Bandung Selatan — Copernicus GLO-30 (30 m)")
    fig.savefig(OUT / "hillshade.png", dpi=130, bbox_inches="tight")
    print(f"\n[viz] {OUT/'hillshade.png'}")


if __name__ == "__main__":
    main()
