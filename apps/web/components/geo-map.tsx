"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { SimModel, ZoneOutcome } from "@simwilayah/engine";

const STATUS_RING: Record<string, string> = {
  ok: "#16a34a",
  warning: "#d97706",
  critical: "#dc2626",
};

function depthFill(depth: number): string {
  const t = Math.min(Math.max(depth, 0) / 1.5, 1);
  const from = [241, 245, 249];
  const to = [30, 58, 138];
  const c = from.map((v, i) => Math.round(v + (to[i]! - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

type BasemapId = "google" | "esri" | "osm";

const BASEMAPS: { id: BasemapId; label: string; attribution: string }[] = [
  { id: "google", label: "Satelit (Google)", attribution: "Imagery © Google" },
  { id: "esri", label: "Satelit (Esri)", attribution: "Imagery © Esri, Maxar" },
  { id: "osm", label: "Peta jalan (OSM)", attribution: "© OpenStreetMap" },
];

// Multi-basemap style. All three raster sources are present; we toggle layer
// `visibility` to switch (cheaper than setStyle, and keeps overlay layers).
// Vector overlays (rivers + boundary) load on `map.load` from /geo/*.geojson.
const STYLE = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    google: {
      type: "raster",
      // lyrs=y → hybrid (citra satelit + jalan + label). Subdomain mt0–3.
      tiles: [0, 1, 2, 3].map(
        (s) => `https://mt${s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}`,
      ),
      tileSize: 256,
      maxzoom: 20,
      attribution: "Imagery © Google",
    },
    esri: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Imagery © Esri, Maxar",
    },
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap",
    },
  },
  layers: [
    {
      id: "bm-google",
      type: "raster",
      source: "google",
      layout: { visibility: "visible" },
    },
    {
      id: "bm-esri",
      type: "raster",
      source: "esri",
      layout: { visibility: "none" },
    },
    {
      id: "bm-osm",
      type: "raster",
      source: "osm",
      layout: { visibility: "none" },
    },
  ],
} as const;

const BASEMAP_LAYERS: Record<BasemapId, string> = {
  google: "bm-google",
  esri: "bm-esri",
  osm: "bm-osm",
};

/** Add the river + boundary overlays on top of the basemap. */
function addOverlays(map: maplibregl.Map) {
  if (!map.getSource("sungai")) {
    map.addSource("sungai", {
      type: "geojson",
      data: "/geo/sungai-kab-bandung.geojson",
    });
  }
  if (!map.getSource("batas")) {
    map.addSource("batas", {
      type: "geojson",
      data: "/geo/batas-kab-bandung.geojson",
    });
  }

  // Kabupaten Bandung outline (context).
  if (!map.getLayer("batas-line")) {
    map.addLayer({
      id: "batas-line",
      type: "line",
      source: "batas",
      paint: {
        "line-color": "#fde047",
        "line-width": 1.6,
        "line-opacity": 0.7,
        "line-dasharray": [3, 2],
      },
    });
  }

  // Streams (minor) — thin, low opacity so they don't swamp the imagery.
  if (!map.getLayer("sungai-minor")) {
    map.addLayer({
      id: "sungai-minor",
      type: "line",
      source: "sungai",
      filter: ["==", ["get", "cls"], "minor"],
      paint: {
        "line-color": "#7dd3fc",
        "line-opacity": 0.55,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.4, 16, 1.6],
      },
    });
  }

  // Canals — dashed.
  if (!map.getLayer("sungai-canal")) {
    map.addLayer({
      id: "sungai-canal",
      type: "line",
      source: "sungai",
      filter: ["==", ["get", "cls"], "canal"],
      paint: {
        "line-color": "#67e8f9",
        "line-opacity": 0.8,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.6, 16, 2],
        "line-dasharray": [2, 1.5],
      },
    });
  }

  // Unnamed rivers — medium.
  if (!map.getLayer("sungai-river")) {
    map.addLayer({
      id: "sungai-river",
      type: "line",
      source: "sungai",
      filter: ["==", ["get", "cls"], "river"],
      paint: {
        "line-color": "#38bdf8",
        "line-opacity": 0.85,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1, 16, 3.2],
      },
    });
  }

  // Named trunk rivers (Citarum, Cikeruh, …) — thick with a dark casing.
  if (!map.getLayer("sungai-major-casing")) {
    map.addLayer({
      id: "sungai-major-casing",
      type: "line",
      source: "sungai",
      filter: ["==", ["get", "cls"], "major"],
      paint: {
        "line-color": "#0c4a6e",
        "line-opacity": 0.7,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2.6, 16, 7],
      },
    });
  }
  if (!map.getLayer("sungai-major")) {
    map.addLayer({
      id: "sungai-major",
      type: "line",
      source: "sungai",
      filter: ["==", ["get", "cls"], "major"],
      paint: {
        "line-color": "#38bdf8",
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.4, 16, 4],
      },
    });
  }

  // River name labels (named rivers only), placed along the line.
  if (!map.getLayer("sungai-label")) {
    map.addLayer({
      id: "sungai-label",
      type: "symbol",
      source: "sungai",
      filter: ["==", ["get", "cls"], "major"],
      minzoom: 11.5,
      layout: {
        "symbol-placement": "line",
        "text-field": ["get", "label"],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 12, 9, 16, 13],
        "text-letter-spacing": 0.04,
      },
      paint: {
        "text-color": "#e0f2fe",
        "text-halo-color": "#0c4a6e",
        "text-halo-width": 1.4,
      },
    });
  }
}

/** Real geographic map: satellite imagery + Kab. Bandung rivers + flood zones. */
export function GeoMap({
  model,
  zones,
  selectedZoneId,
  onSelectZone,
}: {
  model: SimModel;
  zones: ZoneOutcome[];
  selectedZoneId?: string | null;
  onSelectZone?: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [basemap, setBasemap] = useState<BasemapId>("google");
  const [glError, setGlError] = useState(false);

  // Initialise the map once. Guard the WebGL init: some locked-down browsers
  // (RDP/VDI, GPU disabled) can't create a WebGL context — fall back to the SVG
  // schema map instead of crashing the whole dashboard.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: STYLE as unknown as maplibregl.StyleSpecification,
        center: [107.695, -6.972],
        zoom: 12,
        attributionControl: false,
      });
    } catch {
      setGlError(true);
      return;
    }
    map.on("error", (e) => {
      const msg = String((e as { error?: unknown }).error ?? "");
      if (msg.toLowerCase().includes("webgl")) setGlError(true);
    });
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    map.addControl(new maplibregl.AttributionControl({ compact: true }));
    map.on("load", () => addOverlays(map));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Switch basemap by toggling raster-layer visibility.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      for (const [id, layerId] of Object.entries(BASEMAP_LAYERS)) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(
            layerId,
            "visibility",
            id === basemap ? "visible" : "none",
          );
        }
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [basemap]);

  // Re-draw zone markers whenever the simulation result changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const byId = new Map(zones.map((z) => [z.zoneId, z]));
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    for (const z of model.zones) {
      const lng = z.attrs.lng;
      const lat = z.attrs.lat;
      if (!lng || !lat) continue;
      const o = byId.get(z.id);
      const depth = o?.severity ?? 0;
      const status = o?.status ?? "ok";
      const hh = z.attrs.households ?? 0;
      const size = 28 + (hh / 4200) * 22;

      const el = document.createElement("button");
      el.style.cssText = `width:${size}px;height:${size}px;border-radius:9999px;background:${depthFill(
        depth,
      )};border:3px solid ${selectedZoneId === z.id ? "#0f172a" : STATUS_RING[status]};color:${
        depth > 0.6 ? "#fff" : "#0f172a"
      };font:600 11px/1 system-ui;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 1px 6px rgba(0,0,0,.55);`;
      el.textContent = depth >= 0.05 ? depth.toFixed(2) : "–";
      el.title = `${z.name} — ${depth.toFixed(2)} m`;
      el.onclick = () => onSelectZone?.(z.id);

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map);
      markersRef.current.push(marker);
    }
  }, [zones, selectedZoneId, model, onSelectZone]);

  if (glError) {
    return (
      <div className="flex h-[460px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center text-sm text-slate-500">
        <span className="text-2xl">🗺️</span>
        <p>
          Peta satelit interaktif memerlukan WebGL yang tidak tersedia di
          browser ini.
        </p>
        <p className="text-xs text-slate-400">
          Gunakan tombol <b>Skema</b> di atas untuk peta versi sederhana —
          seluruh angka simulasi tetap akurat.
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="h-[460px] w-full overflow-hidden rounded-xl border border-slate-200"
      />
      {/* Basemap switcher */}
      <div className="absolute left-2 top-2 z-10 flex rounded-lg border border-slate-300 bg-white/90 p-0.5 text-[11px] shadow-sm backdrop-blur">
        {BASEMAPS.map((b) => (
          <button
            key={b.id}
            onClick={() => setBasemap(b.id)}
            className={`rounded-md px-2 py-1 ${
              basemap === b.id
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}
