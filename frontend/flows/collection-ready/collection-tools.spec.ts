/**
 * Flow: the collection tools surface (scenario: collection-ready).
 *
 * 1. Log in via the API (auth is not the subject) and deep-link to the
 *    seeded collection's overview.
 * 2. Expect the Tools panel to list the primary search tool projected from
 *    the default retrieval pipeline (`search_<collection-slug>`, chunks).
 * 3. Disable and re-enable the tool through the panel and expect the state
 *    to round-trip through the tools API.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

test("seeded collection exposes its primary search tool in the tools panel", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(seededLink(handoff, "collection"));
  await expect(page.getByText("search_sandbox_collection")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/returns chunks/)).toBeVisible();
  await expect(page.getByText(/primary search/)).toBeVisible();

  await page.getByRole("button", { name: "Disable" }).click();
  await expect(page.getByText(/• disabled/)).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Enable", exact: true }).click();
  await expect(page.getByText(/• disabled/)).toHaveCount(0, { timeout: 20_000 });
});
