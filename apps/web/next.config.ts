import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The simulation engine is a raw-TypeScript workspace package; let Next
  // compile it instead of expecting a pre-built dist.
  transpilePackages: ["@simwilayah/engine"],
  // Allow dev assets (HMR + dynamic-import chunks) to be fetched when the app
  // is opened from the Mac Mini's Tailscale IP — otherwise Next blocks them as
  // cross-origin and client-only components (the map) hang on "Memuat peta…".
  allowedDevOrigins: ["100.81.47.91"],
};

export default nextConfig;
