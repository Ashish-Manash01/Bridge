import type { NextConfig } from "next";

// Static export: the app is a client-side PWA that talks to the FastAPI
// backend over REST + WebSocket. The export can be served by any static host
// or by the API itself (STATIC_DIR) for a single-origin deployment.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: false,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
