# SimWilayah — Catatan Proyek & Handoff

> Dokumen ini merekam **keseluruhan** keadaan proyek per **1 Juni 2026** agar sesi
> kerja berikutnya (di Mac Mini) bisa lanjut tanpa kehilangan konteks.

## 1. Tujuan & latar

Alat bantu keputusan (decision-support) untuk **membandingkan solusi penanganan
masalah daerah** sebelum anggaran dikeluarkan. Bukan mesin hidrolika; ini alat
*screening & komunikasi* cepat (setara tier WRI Aqueduct CBA, bukan HEC-RAS/ICM).

**Modul pertama: Banjir Tegalluar, Kec. Bojongsoang, Kab. Bandung.**

Akar masalah Tegalluar (yang dimodelkan): kawasan muara Cikeruh + Citarik +
Citarum, elevasi tanah ≈ muka sungai. Sedimentasi ~10 juta m³ menaikkan dasar
sungai → efek **backwater**: saat Citarum naik, drainase lokal terkunci, air tak
bisa keluar. Banjir berulang: Nov 2024, Jan/Mar/Mei 2025, Mei 2026 (0,6–1,2 m,
ribuan rumah). Solusi yang diwacanakan pemda: normalisasi/keruk sedimen, 2 danau
retensi + kolam KCIC (~300 ha), perbaikan drainase, EWS.

Tujuan kedua (sudah dibuktikan arsitekturnya): **generik** — mesin + plugin domain,
bisa dipakai masalah lain (macet, sampah, dst) di daerah manapun.

## 2. Tech stack

- Monorepo **pnpm** (`apps/*`, `packages/*`).
- **packages/engine** — mesin simulasi TypeScript murni, framework-agnostic, jalan
  di browser. Diuji dengan **Vitest** (14 test, semua hijau).
- **apps/web** — **Next.js 16.2 + React 19.2 + Tailwind v4** (App Router, Turbopack).
- **maplibre-gl 5** — peta georeferensi (basemap OpenStreetMap raster).

## 3. Arsitektur

```
packages/engine/src/
  types.ts        Zone, ParamSpec (driver+lever), Kpi, ZoneOutcome, SimModel (kontrak plugin),
                  helper zeroLevers/defaultDrivers/leverCost
  runner.ts       compare(baseline vs skenario), rankScenarios(cost-effectiveness), monteCarlo()
  rng.ts          PRNG deterministik (mulberry32) + triangular() untuk Monte Carlo
  domains/flood/
    model.ts      createFloodModel(config) — water-balance per zona + efek backwater
    tegalluar.ts  FloodConfig Tegalluar (zona, koef, biaya) + 5 preset solusi
  __tests__/flood.test.ts

apps/web/
  app/page.tsx              dashboard (client) — orkestrasi semua
  components/zone-map.tsx    peta skema SVG (fallback, no-internet)
  components/geo-map.tsx     peta georeferensi MapLibre + OSM (default)
  components/charts.tsx      timeline muka sungai vs kedalaman
  components/controls.tsx    slider driver + lever
  components/panels.tsx      KPI cards, cost-effectiveness, ranking table, preset bar
  lib/format.ts             format IDR/angka id-ID
```

### Konsep inti
- **Zone**: unit wilayah, punya `attrs` bebas (elevation_m, households, lat, lng, srtm_elevation_m, …).
- **ParamSpec**: parameter tersetel. *driver* = kondisi lingkungan (hujan, kenaikan Citarum); *lever* = intervensi berbiaya (keruk, retensi, drainase, EWS).
- **SimModel**: tiap domain implement `run({drivers, levers}) → {kpis, zones, timeline, totalCost}`.
- Dashboard **agnostik** terhadap SimModel — slider/peta/KPI/ranking otomatis ikut deklarasi domain.

### Mekanisme model banjir (model.ts)
Tiap zona = ember. Hujan + (saat sungai meluap) air sungai masuk; drainase membuang
ke sungai **hanya bila muka sungai < elevasi tanah**. Bila Citarum naik di atas zona
→ drainase = 0 (backwater) + air sungai merembes masuk. Implikasi (terlihat di
output): **upgrade drainase saja nyaris nihil**; yang efektif = **keruk** (turunkan
muka sungai) & **danau retensi** (tambah tampungan).

## 4. Keputusan penting & gotchas

- **Import extensionless** di engine (`from "./types"`, BUKAN `"./types.js"`).
  Turbopack tidak me-rewrite `.js`→`.ts` untuk transpilePackages; pakai extensionless
  (aman untuk Vitest + Turbopack dengan `moduleResolution: Bundler`).
- `next.config.ts` punya `transpilePackages: ["@simwilayah/engine"]` — engine dipakai
  sebagai sumber TS mentah (tanpa build step).
- **DEM/SRTM**: koordinat zona NYATA (WGS84) + elevasi SRTM30m NYATA (OpenTopoData
  `api.opentopodata.org/v1/srtm30m`). TAPI galat vertikal SRTM (~6–16 m) > kedalaman
  banjir (~1 m) — bahkan SRTM menaruh Bojongsoang (dataran rendah padat) di 672 m
  (tertinggi), bertentangan dengan realita. Maka: SRTM dipakai untuk **georeferensi
  + transparansi**, simulasi tetap jalan di **`elevation_m` (datum kalibrasi)**.
  Untuk fidelitas sungguhan butuh **DEMNAS (~8 m) / LiDAR (~0,15 m)** + model genangan
  per-sel terrain (DEMNAS hanya bisa diunduh manual dari tanahair.indonesia.go.id).
- **Peta nyata butuh internet** di sisi klien (tile OSM diunduh device penonton).
  Mode "Skema" (SVG) jadi fallback tanpa internet.
- Semua parameter (koef hidro, biaya Rp, zona) = **asumsi tersetel** di `tegalluar.ts`,
  dari laporan publik 2024–2026. Bukan pengukuran.

## 5. Hasil saat ini (sanity check)
- Baseline (tanpa intervensi): ~11.850 rumah terendam, 830 ha, kedalaman puncak 0,76 m.
- Ranking cost-effectiveness (termurah/rumah): (1) keruk sedimen Rp 62,5 jt/rumah,
  (2) danau retensi Rp 94,6 jt, (3) terintegrasi Rp 110,3 jt (selamatkan terbanyak: 7.650),
  (4) EWS+drainase ringan = 0 rumah (depth tak berubah; nilainya di KPI "tanpa peringatan").

## 6. Posisi vs industri (analisis kompetitif)
- **Tier mesin hidrolika (engineering)**: #1 InfoWorks ICM (Autodesk), HEC-RAS (gratis,
  standar global), MIKE FLOOD. SimWilayah BUKAN pesaing ini.
- **Tier decision-support/CBA**: #1 WRI Aqueduct Floods Cost-Benefit Analyzer. Di sini
  SimWilayah ~78% match (kalah di "data nyata").
- Match vs InfoWorks ICM (baseline=100) ≈ **52%** setelah DEM masuk. Decompose:
  fidelitas engineering ~16%, lapisan decision-support ~92%.
- Posisi strategis: jalan **di hulu** workflow — saring opsi + dapat buy-in pemda
  cepat, lalu opsi terpilih dimodel detail di HEC-RAS/ICM.

## 7. Cara jalanin
```bash
pnpm install
pnpm dev      # http://localhost:3000
pnpm test     # Vitest (14 test)
pnpm build    # produksi
```

## 8. Roadmap / next steps (urut prioritas)
1. **DEMNAS/LiDAR + genangan per-sel terrain** → naikkan fidelitas ke kelas HEC-RAS.
   (DEMNAS unduh manual; siapkan pipeline ingest GeoTIFF.)
2. **Tombol "Optimasi"** — auto-cari kombinasi lever termurah yang capai target
   (mis. < 2.000 rumah terendam).
3. **Panel Monte Carlo di UI** — `monteCarlo()` sudah ada di engine; visualisasikan
   reliability % terhadap hujan ekstrem.
4. **Export laporan PDF** untuk rapat pemda.
5. **Domain kedua** (mis. simulasi macet) untuk membuktikan platform multi-masalah.
6. **Validasi vs banjir historis** (Jan 2025, Mei 2026) untuk kredibilitas.

## 9. Sumber riset
- Kompasiana — pendangkalan Citarum & banjir Sapan Tegalluar
- Teropong Media / Radar Jabar — KDS desak keruk Cikeruh, penanganan terintegrasi
- inijabar / jabarindo — Bupati minta normalisasi sedimen (~10 jt m³)
- Detik — 4 ribuan warga terdampak banjir Desa Tegalluar (Mei 2026)
- Republika — stasiun kereta cepat rawan banjir, wajib danau retensi (~300 ha)
- Kompas — Pemkab Bandung matangkan EWS Baleendah–Bojongsoang
- Autodesk (ICM vs HEC-RAS), FEMA flood software, WRI Aqueduct, Springer (CBA mitigasi)
- DEM: OpenTopoData SRTM30m (api.opentopodata.org)
