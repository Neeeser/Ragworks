import { readFileSync } from "fs";
import path from "path";

import { expect, type Page } from "@playwright/test";

export interface SandboxHandoff {
  scenario: string;
  frontend_url: string;
  backend_url: string;
  email: string | null;
  password: string | null;
  token: string | null;
  links: { label: string; url: string }[];
  facts: string[];
}

/** The seed handoff written by `sandbox up`/`seed` — URLs, credentials, and
 * deep links to seeded objects, so specs never hardcode ids. */
export function loadHandoff(): SandboxHandoff {
  const handoffPath = path.resolve(__dirname, "../../.sandbox/handoff.json");
  return JSON.parse(readFileSync(handoffPath, "utf-8")) as SandboxHandoff;
}

/** Deep link for a seeded object by its handoff label (e.g. "collection"). */
export function seededLink(handoff: SandboxHandoff, label: string): string {
  const link = handoff.links.find((entry) => entry.label === label);
  if (!link) {
    const known = handoff.links.map((entry) => entry.label).join(", ");
    throw new Error(`No seeded link labeled "${label}" (have: ${known})`);
  }
  return link.url;
}

/** Open the sign-in page and wait until the form is interactive. The submit
 * button stays disabled during the initial auth check, and clicking before
 * React hydrates silently does nothing — flows that drive the form must go
 * through this. */
export async function gotoSignIn(page: Page): Promise<void> {
  await page.goto("/auth/sign-in");
  await expect(page.getByRole("button", { name: "Enter dashboard" })).toBeEnabled({
    timeout: 30_000,
  });
}

/** Log the browser context in without the sign-in form: POST the token
 * endpoint through the context's request client (shared cookie jar) so the
 * refresh cookie authenticates every subsequent page load. Flows that test
 * auth itself use the form instead. */
export async function loginViaApi(page: Page): Promise<void> {
  const handoff = loadHandoff();
  if (!handoff.email || !handoff.password) {
    throw new Error(`Scenario "${handoff.scenario}" seeds no user to log in as.`);
  }
  const response = await page.context().request.post(`${handoff.backend_url}/api/auth/token`, {
    form: {
      grant_type: "password",
      username: handoff.email,
      password: handoff.password,
      remember_me: "true",
    },
  });
  if (!response.ok()) {
    throw new Error(`Sandbox login failed: ${response.status()} ${await response.text()}`);
  }
}
