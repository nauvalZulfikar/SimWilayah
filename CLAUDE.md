# CLAUDE.md — SimWilayah

Sandbox simulasi kebijakan daerah: **mesin generik + plugin domain**. Modul pertama:
banjir Tegalluar (Kab. Bandung). Lihat `docs/HANDOFF.md` untuk catatan lengkap & roadmap.

## Stack
pnpm monorepo · `packages/engine` (TS murni, Vitest) · `apps/web` (Next.js 16 + React 19 +
Tailwind v4 + maplibre-gl, App Router/Turbopack). Engine dipakai sebagai TS mentah via
`transpilePackages` — tanpa build step.

## Perintah
```bash
pnpm install
pnpm dev     # http://localhost:3000
pnpm test    # Vitest engine (14 test)
pnpm build
```

## Konvensi & gotchas (WAJIB diperhatikan)
- **Import relatif di engine harus extensionless** (`from "./types"`), JANGAN `.js` —
  Turbopack tak rewrite `.js`→`.ts`. `moduleResolution: Bundler`.
- Tambah domain baru: buat `packages/engine/src/domains/<x>/`, implement `SimModel`
  (atau factory `create<X>Model(config)`), export dari `src/index.ts`. UI tidak diubah.
- Banjir: `elevation_m` = datum **kalibrasi** yang dipakai model. `srtm_elevation_m` =
  SRTM30m mentah, hanya untuk tampilan/transparansi (terlalu kasar untuk menggerakkan
  kedalaman). Jangan tukar keduanya.
- Peta "nyata" (MapLibre/OSM) butuh internet di klien; "Skema" (SVG) = fallback.
- Semua angka di `domains/flood/tegalluar.ts` = asumsi tersetel (laporan publik
  2024–2026), bukan pengukuran. Kalibrasi ulang di file itu saja.
- **Mac Mini**: pnpm di-hardened (blok build-script + minimumReleaseAge). Repo punya
  `.npmrc` (`verify-deps-before-run=false`) agar `pnpm dev`/`pnpm test` jalan tanpa
  melemahkan policy. Jika `pnpm install` exit non-zero karena ERR_PNPM_IGNORED_BUILDS,
  itu hanya warning — node_modules tetap lengkap (binary prebuilt). Lockfile di Mac
  di-resolve ulang (versi lebih lama) sesuai policy; ini wajar, jangan paksa versi laptop.

## Aturan kerja
- Test iteratif sampai benar-benar jalan (bukan sekadar compile); verifikasi UI di
  browser nyata bila menyangkut alur tampilan.
- Jangan klaim "selesai" bila test merah / implementasi parsial.
