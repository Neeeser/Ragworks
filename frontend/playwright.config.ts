import { defineConfig, devices } from "@playwright/test";

// Browser flow tests for sandbox scenarios (docs/sandbox.md). No webServer:
// the sandbox harness owns the reset → seed → serve lifecycle, so run these
// via `uv run python -m sandbox flows`, never bare `npx playwright test`.
export default defineConfig({
  testDir: "./flows",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["line"]],
  timeout: 120_000,
  use: {
    baseURL: process.env.SANDBOX_FRONTEND_URL ?? "http://127.0.0.1:3010",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
