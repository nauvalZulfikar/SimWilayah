import type { ParamSpec, ParamValues } from "../../types";
import { createFloodModel, type FloodConfig } from "./model";

const MILIAR = 1_000_000_000;

/**
 * Cekungan Bandung Selatan (Citarum Hulu) — banjir tahunan di Kab. Bandung.
 *
 * Sandbox keputusan & anggaran tingkat-cekungan (BUKAN HEC-RAS). Mencakup titik
 * banjir kronis di sepanjang Citarum Hulu: muara Cikeruh–Citarik–Citarum
 * (Tegalluar/Bojongsoang) + bowl Baleendah–Dayeuhkolot. Kalibrasi sintetik dari
 * laporan publik 2024–2026:
 * - pertemuan Cikeruh+Citarik+Citarum, tanah ≈ muka sungai → backwater kronis
 * - ±10 juta m³ sedimentasi mengangkat dasar Citarum (belum dikeruk)
 * - kedalaman banjir teramati ~0,5–1,5 m; Dayeuhkolot ±9.246 KK terdampak (Nov 2025)
 * - infrastruktur Citarum Harum yang SUDAH terbangun (Perpres 15/2018):
 *     Kolam Cieunteung ~0,70 jt m³ + Andir ~0,16 jt m³ + Embung Gedebage ~0,27 jt m³
 *     + kolam KCIC/Tegalluar ~2 jt m³  ≈ 3 jt m³ retensi terpasang.
 *     Terowongan Nanjung (230 m) + Floodway Cisangkuy (215 m³/s) = konveyans yang
 *     sudah dibangun → sudah tercermin di kalibrasi muka air dasar (baseRiverLevel).
 * SETIAP angka di bawah = asumsi tersetel, bukan pengukuran. Kalibrasi ulang di sini.
 */

const drivers: ParamSpec[] = [
  {
    id: "rain_mm",
    label: "Curah hujan (total kejadian)",
    description: "Total hujan selama satu kejadian badai.",
    unit: "mm",
    min: 20,
    max: 220,
    step: 5,
    default: 95,
    costPerUnit: 0,
    fixedCost: 0,
  },
  {
    id: "duration_h",
    label: "Durasi hujan",
    description: "Lama hujan turun.",
    unit: "jam",
    min: 2,
    max: 24,
    step: 1,
    default: 6,
    costPerUnit: 0,
    fixedCost: 0,
  },
  {
    id: "upstream_rise_m",
    label: "Kenaikan muka Citarum",
    description:
      "Kenaikan permukaan Sungai Citarum dari kiriman hulu (Sumedang/Kota Bandung/Pengalengan/Ciwidey).",
    unit: "m",
    min: 0,
    max: 5,
    step: 0.1,
    default: 3.2,
    costPerUnit: 0,
    fixedCost: 0,
  },
];

const levers: ParamSpec[] = [
  {
    id: "dredge",
    label: "Normalisasi / keruk sedimen",
    description:
      "Pengerukan sedimen muara Cikeruh–Citarik–Citarum (±10 jt m³). Menurunkan muka air sungai & menambah daya alir.",
    unit: "juta m³",
    min: 0,
    max: 12,
    step: 0.5,
    default: 0,
    costPerUnit: 45 * MILIAR, // ~Rp45 rb/m³
    fixedCost: 0,
    authority: "BBWS Citarum (Pusat / PUPR)",
    fundingSource: "APBN",
    scope: "pusat",
  },
  {
    id: "retention",
    label: "Danau / kolam retensi",
    description:
      "Kapasitas tampung tambahan (danau retensi + kolam/polder seperti Cieunteung/Andir/Gedebage).",
    unit: "juta m³",
    min: 0,
    max: 10,
    step: 0.5,
    default: 0,
    costPerUnit: 70 * MILIAR,
    fixedCost: 20 * MILIAR, // pembebasan lahan / mobilisasi
    authority: "Dinas SDA Jabar (Provinsi)",
    fundingSource: "APBD Prov",
    scope: "provinsi",
  },
  {
    id: "drainage",
    label: "Peningkatan drainase",
    description:
      "Perbesar & perbaiki saluran drainase lokal + pompa (mengurangi sumbatan, naikkan daya buang).",
    unit: "%",
    min: 0,
    max: 100,
    step: 5,
    default: 0,
    costPerUnit: 1.5 * MILIAR,
    fixedCost: 5 * MILIAR,
    authority: "DPUTR Kab. Bandung",
    fundingSource: "APBD Kab",
    scope: "kabupaten",
  },
  {
    id: "ews",
    label: "Sistem peringatan dini (EWS)",
    description:
      "Sensor + sirine + protokol evakuasi. Tidak menurunkan genangan, tapi melindungi warga sebelum air datang.",
    unit: "%",
    min: 0,
    max: 100,
    step: 5,
    default: 0,
    costPerUnit: 0.15 * MILIAR,
    fixedCost: 4 * MILIAR,
    authority: "BPBD Kab. Bandung",
    fundingSource: "APBD Kab",
    scope: "kabupaten",
  },
];

export const tegalluarConfig: FloodConfig = {
  id: "bandung-selatan-flood",
  title: "Banjir Cekungan Bandung Selatan (Citarum Hulu)",
  description:
    "Titik banjir kronis Citarum Hulu: muara Cikeruh–Citarik–Citarum (Tegalluar/Bojongsoang) sampai bowl Baleendah–Dayeuhkolot. Tanah ≈ muka sungai + sedimentasi ~10 jt m³ memicu backwater: drainase terkunci saat Citarum naik. Baseline sudah memperhitungkan infrastruktur Citarum Harum yang terbangun (retensi ~3 jt m³, Terowongan Nanjung, Floodway Cisangkuy).",
  baseRiverLevel_m: 657.6,
  // Sudah terbangun (asumsi, dapat diedit). Retensi terpasang ≈ 3 jt m³ =
  // Cieunteung 0,70 + Andir 0,16 + Gedebage 0,27 + kolam KCIC/Tegalluar ~2.
  // Sedimen ~10 jt m³ belum dikeruk → dredge eksisting 0. Drainase lokal & EWS
  // belum terbangun. Baseline do-nothing berjalan di level ini; anggaran hanya
  // membayar penambahan di atasnya. (Terowongan Nanjung + Floodway Cisangkuy =
  // konveyans terbangun, sudah tercermin di baseRiverLevel, bukan di sini.)
  existing: { retention: 3, dredge: 0, drainage: 0, ews: 0 },
  coef: {
    dredgeLevelPerJuta: 0.12, // 10 juta m³ ⇒ turun ~1.2 m
    dredgeConveyancePerJuta: 0.02,
    drainGainAtFull: 1.5, // upgrade 100% ⇒ drainase 2.5×
    retentionPerJuta_m3: 1_000_000,
    ingressCoef: 0.04,
    ingressCapM: 2.0,
    drainHeadM: 1.5,
    riverPeakHour: 5,
    ewsEffectAtFull: 0.85,
    floodThresholdM: 0.1,
    criticalThresholdM: 0.4,
  },
  drivers,
  levers,
  // Layout coords (x,y in 0..100) sketch the basin: river runs low across the
  // south; the confluence/muara + Baleendah–Dayeuhkolot bowl sit lowest.
  // elevation_m = calibrated floodplain datum (drives the model).
  // srtm_elevation_m = raw SRTM30m sample at (lat,lng) — real but too coarse to
  // drive depth; kept for transparency. lat/lng anchor the georeferenced map.
  // flooded_observed = tergenang pada kejadian nyata (Nov 2025) → cek kalibrasi.
  zones: [
    {
      id: "muara",
      name: "Muara Cikeruh–Citarik",
      x: 50,
      y: 80,
      lat: -6.988,
      lng: 107.695,
      srtm_elevation_m: 660,
      area_ha: 120,
      elevation_m: 656.8,
      households: 850,
      base_storage_mm: 18,
      drainage_rate_mm_per_h: 4,
      retention_eligible: true,
      flooded_observed: true,
    },
    {
      id: "dayeuhkolot",
      name: "Dayeuhkolot",
      x: 30,
      y: 86,
      lat: -6.9883,
      lng: 107.6322,
      srtm_elevation_m: 659,
      area_ha: 210,
      elevation_m: 657.0,
      households: 9200, // ±9.246 KK terdampak (Nov 2025)
      base_storage_mm: 20,
      drainage_rate_mm_per_h: 5,
      retention_eligible: true, // dilayani Kolam Cieunteung
      flooded_observed: true,
    },
    {
      id: "baleendah",
      name: "Baleendah",
      x: 18,
      y: 78,
      lat: -7.0052,
      lng: 107.6206,
      srtm_elevation_m: 661,
      area_ha: 240,
      elevation_m: 657.2,
      households: 7000,
      base_storage_mm: 22,
      drainage_rate_mm_per_h: 5,
      retention_eligible: true, // dilayani Kolam Cieunteung/Andir
      flooded_observed: true,
    },
    {
      id: "sapan",
      name: "Sapan",
      x: 38,
      y: 66,
      lat: -6.976,
      lng: 107.705,
      srtm_elevation_m: 663,
      area_ha: 180,
      elevation_m: 657.4,
      households: 2600,
      base_storage_mm: 22,
      drainage_rate_mm_per_h: 5,
      retention_eligible: true,
      flooded_observed: true,
    },
    {
      id: "stasiun",
      name: "Tegalluar / Stasiun Whoosh",
      x: 66,
      y: 60,
      lat: -6.9747,
      lng: 107.7166,
      srtm_elevation_m: 662,
      area_ha: 150,
      elevation_m: 658.2,
      households: 1200,
      base_storage_mm: 25,
      drainage_rate_mm_per_h: 6,
      retention_eligible: true,
      flooded_observed: true,
    },
    {
      id: "bojongsoang",
      name: "Bojongsoang Inti",
      x: 44,
      y: 50,
      lat: -6.971,
      lng: 107.6383,
      srtm_elevation_m: 672,
      area_ha: 220,
      elevation_m: 658.8,
      households: 4200,
      base_storage_mm: 28,
      drainage_rate_mm_per_h: 6,
      retention_eligible: false,
      flooded_observed: true,
    },
    {
      id: "cijagra",
      name: "Cijagra",
      x: 26,
      y: 40,
      lat: -6.962,
      lng: 107.63,
      srtm_elevation_m: 670,
      area_ha: 160,
      elevation_m: 659.5,
      households: 3000,
      base_storage_mm: 30,
      drainage_rate_mm_per_h: 7,
      retention_eligible: false,
    },
    {
      id: "citeureup",
      name: "Citeureup",
      x: 60,
      y: 34,
      lat: -6.956,
      lng: 107.69,
      srtm_elevation_m: 664,
      area_ha: 140,
      elevation_m: 660.4,
      households: 2500,
      base_storage_mm: 32,
      drainage_rate_mm_per_h: 7,
      retention_eligible: false,
    },
    {
      id: "panyileukan",
      name: "Tepi Panyileukan",
      x: 40,
      y: 22,
      lat: -6.945,
      lng: 107.705,
      srtm_elevation_m: 669,
      area_ha: 130,
      elevation_m: 661.0,
      households: 2000,
      base_storage_mm: 34,
      drainage_rate_mm_per_h: 8,
      retention_eligible: false,
    },
  ],
};

export const tegalluarModel = createFloodModel(tegalluarConfig);

/** Named intervention packages echoing what the government has floated. */
export interface PresetScenario {
  id: string;
  name: string;
  summary: string;
  levers: ParamValues;
}

export const tegalluarPresets: PresetScenario[] = [
  {
    id: "baseline",
    name: "Tanpa intervensi baru",
    summary: "Hanya infrastruktur eksisting (retensi ~3 jt m³) — pembanding.",
    levers: { dredge: 0, retention: 3, drainage: 0, ews: 0 },
  },
  {
    id: "kabupaten-only",
    name: "Kewenangan DPUTR Kab. saja",
    summary:
      "Yang bisa dikerjakan kabupaten sendiri: drainase lokal penuh + EWS penuh (tanpa keruk Citarum/retensi besar).",
    levers: { dredge: 0, retention: 3, drainage: 100, ews: 100 },
  },
  {
    id: "dredge-only",
    name: "Hanya normalisasi sedimen",
    summary: "Keruk ~10 juta m³ sesuai usulan Bupati (kewenangan BBWS/pusat).",
    levers: { dredge: 10, retention: 3, drainage: 0, ews: 0 },
  },
  {
    id: "retention-only",
    name: "Tambah danau retensi",
    summary:
      "Tambah retensi jadi ~6 juta m³ (eksisting + baru, kewenangan prov).",
    levers: { dredge: 0, retention: 6, drainage: 0, ews: 0 },
  },
  {
    id: "integrated",
    name: "Terintegrasi (rekomendasi)",
    summary:
      "Keruk + retensi + drainase + EWS — penanganan terpadu lintas instansi.",
    levers: { dredge: 8, retention: 6, drainage: 60, ews: 100 },
  },
];

/**
 * Skenario hujan kala-ulang (design storm). Mengubah driver sekaligus agar
 * pengguna bisa stress-test paket terhadap hujan yang makin ekstrem — bukan
 * angka acak. Dapat dikalibrasi ulang dari data BMKG/return-period setempat.
 */
export interface RainScenario {
  id: string;
  name: string;
  summary: string;
  drivers: ParamValues;
}

export const tegalluarRainScenarios: RainScenario[] = [
  {
    id: "biasa",
    name: "Hujan biasa (≈Q2)",
    summary: "Kejadian rutin musim hujan.",
    drivers: { rain_mm: 70, duration_h: 6, upstream_rise_m: 2.0 },
  },
  {
    id: "q5",
    name: "Kala ulang 5 th (≈Q5)",
    summary: "Acuan desain umum.",
    drivers: { rain_mm: 95, duration_h: 6, upstream_rise_m: 3.2 },
  },
  {
    id: "q25",
    name: "Kala ulang 25 th (≈Q25)",
    summary: "Hujan lebat berkepanjangan + kiriman hulu tinggi.",
    drivers: { rain_mm: 140, duration_h: 8, upstream_rise_m: 4.0 },
  },
  {
    id: "ekstrem",
    name: "Ekstrem (≈Nov 2025)",
    summary: "Mendekati kejadian banjir besar Dayeuhkolot–Baleendah 2025.",
    drivers: { rain_mm: 180, duration_h: 10, upstream_rise_m: 4.6 },
  },
];
