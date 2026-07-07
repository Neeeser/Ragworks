import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output produces a self-contained server bundle for the Docker image.
  output: "standalone",
  compiler: {
    removeConsole: { exclude: ["error", "warn"] },
  },
  // The runtime API_PROXY_TARGET proxy lives in src/middleware.ts, not here:
  // rewrites() is evaluated once at `next build` and baked into the routes
  // manifest, so it can never see an env var set later when the container
  // starts (see src/middleware.ts for the full explanation).
};

export default nextConfig;
