import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output produces a self-contained server bundle for the Docker image.
  output: "standalone",
  // The sandbox harness runs its own dev server on a second port while a normal
  // `make frontend` may be running. Both would otherwise share `.next`, and
  // whichever compiled last wins: NEXT_PUBLIC_* values are inlined into client
  // chunks, so the sandbox's frontend would silently start calling the dev
  // backend (localhost:8000) instead of its own. An override lets the harness
  // own a separate build directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  compiler: {
    removeConsole: { exclude: ["error", "warn"] },
  },
  // The runtime API_PROXY_TARGET proxy lives in src/middleware.ts, not here:
  // rewrites() is evaluated once at `next build` and baked into the routes
  // manifest, so it can never see an env var set later when the container
  // starts (see src/middleware.ts for the full explanation).
};

export default nextConfig;
