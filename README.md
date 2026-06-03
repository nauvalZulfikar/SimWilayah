# SimWilayah — Sandbox Simulasi Kebijakan Daerah

Alat bantu keputusan (decision-support) untuk **membandingkan solusi penanganan
masalah daerah** sebelum anggaran dikeluarkan. Modul pertama: **Banjir Tegalluar,
Kec. Bojongsoang, Kab. Bandung**.

Geser slider intervensi → langsung lihat peta genangan, jumlah rumah terselamatkan,
biaya, dan **ranking solusi paling murah-paling-efektif**. Semua dihitung di
browser (instan, tanpa server).

> Modelnya **water-balance tersederhanakan** yang menangkap mekanisme inti banjir
> Tegalluar (efek *backwater* di muara Cikeruh–Citarik–Citarum). Ini alat
> perbandingan kebijakan, **bukan** pengganti studi hidrologi teknis (DEM/HEC-RAS).
> Semua parameter adalah asumsi dari laporan publik 2024–2026 dan bisa dikalibrasi
> ulang begitu ada data resmi.

## Jalankan

```bash
pnpm install
pnpm dev      # buka http://localhost:3000
pnpm test     # uji mesin simulasi (Vitest)
```

## Arsitektur

Monorepo pnpm. Intinya: **mesin generik + plugin domain**, jadi alat yang sama
bisa dipakai untuk "berbagai masalah di daerah manapun".

```
simwilayah/
├── packages/engine/        # mesin simulasi (TypeScript murni, framework-agnostic)
│   └── src/
│       ├── types.ts        # Zone, ParamSpec (driver+lever), KPI, SimModel (kontrak plugin)
│       ├── runner.ts       # compare(), rankScenarios(), monteCarlo()
│       ├── rng.ts          # PRNG deterministik untuk Monte Carlo
│       └── domains/
│           └── flood/      # PLUGIN: model banjir + skenario Tegalluar
└── apps/web/               # dashboard Next.js 16 + React 19 + Tailwind v4
```

### Konsep inti

- **Zone** — unit wilayah (kelurahan/RW/grid). Punya `attrs` bebas (elevasi, jumlah rumah, …).
- **ParamSpec** — parameter yang bisa disetel. Dua jenis:
  - *driver* = kondisi lingkungan (curah hujan, kenaikan muka sungai)
  - *lever* = intervensi kebijakan yang berbiaya (keruk, danau retensi, drainase, EWS)
- **SimModel** — kontrak yang diimplementasikan tiap domain: `run({drivers, levers}) → {kpis, zones, timeline, totalCost}`.
- **runner** — `compare()` (baseline vs skenario), `rankScenarios()` (urut cost-effectiveness), `monteCarlo()` (uji ketahanan terhadap ketidakpastian cuaca).

### Mekanisme model banjir

Tiap zona = ember. Hujan (dan air sungai saat meluap) masuk; drainase membuang ke
sungai — **tapi hanya selama muka sungai di bawah elevasi tanah**. Begitu Citarum
naik di atas zona (realita Tegalluar), drainase terkunci (*backwater*) dan air
terjebak. Inilah kenapa di simulasi **upgrade drainase saja nyaris tak berdampak**,
sementara **pengerukan** (menurunkan muka sungai) dan **danau retensi** (menambah
tampungan) efektif.

## Menambah domain/masalah baru (mis. macet, sampah)

Tidak perlu menyentuh UI maupun runner. Cukup:

1. Buat folder `packages/engine/src/domains/<masalah>/`.
2. Implementasikan `SimModel` (atau bikin factory `create<Masalah>Model(config)`
   seperti `createFloodModel`).
3. Definisikan `zones`, `drivers`, `levers` (dengan biaya), dan fungsi `run()`
   yang mengembalikan `kpis`, `zones` (severity untuk peta), `timeline`, `totalCost`.
4. Export dari `src/index.ts`.

Dashboard sudah generik terhadap `SimModel` — peta, slider, kartu KPI, dan tabel
ranking otomatis mengikuti `levers`/`drivers`/`kpis` yang dideklarasikan domain.

## Kalibrasi ke daerah lain

Edit/duplikasi `domains/flood/tegalluar.ts`: ganti daftar `zones` (elevasi, jumlah
rumah, luas), `baseRiverLevel_m`, koefisien `coef`, dan biaya `levers`. Tidak ada
yang di-hardcode di luar file konfigurasi itu.
