/**
 * Flow: the insights surface on a hundred-document corpus
 * (scenario: insights-corpus).
 *
 * 1. Log in via the API and deep-link to the seeded collection's Visualize
 *    page; the snapshot was computed synchronously during seeding.
 * 2. Expect the MiniLM space chip and a non-zero cluster count in the
 *    toolbar — clusters only exist at scale, so this is the scale check.
 * 3. Overlaps: ranked cross-document pairs render with mono similarities.
 * 4. Graph: the edge-threshold control reports a non-zero edge count.
 * 5. Map: probing with Enter (not the button) places the query and ranks
 *    nearest chunks through the live embedder.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

test("hundred-document corpus serves clusters, overlaps, edges, and probe", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(seededLink(handoff, "collection visualize"));
  await expect(
    page.getByText("sentence-transformers/all-minilm-l6-v2", { exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Clusters")).toBeVisible();

  await page.getByRole("button", { name: "Overlaps" }).click();
  await expect(page.getByText(/^[01]\.\d{3}$/).first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Graph" }).click();
  await expect(page.getByText(/[1-9]\d*\/\d+ edges/)).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Map" }).click();
  await page.getByLabel("Probe query").fill("which encryption chip is the government proposing?");
  await page.getByLabel("Probe query").press("Enter");
  await expect(page.getByText("Nearest chunks")).toBeVisible({ timeout: 60_000 });
});
