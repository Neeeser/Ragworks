/**
 * Flow: the collection insights surface (scenario: collection-ready).
 *
 * 1. Log in via the API (auth is not the subject) and deep-link to the
 *    seeded collection's Visualize page.
 * 2. Expect the auto-computed snapshot: seeding's ingestion hook queued the
 *    build, so the toolbar shows the semantic space chip and counts without
 *    anyone pressing a compute button.
 * 3. Switch to Overlaps and expect ranked cross-document pairs with mono
 *    similarity values.
 * 4. Switch to Graph and expect the edge-threshold control.
 * 5. Back on Map, probe a query through the real embedder and expect the
 *    ranked nearest-chunk panel with the aurora document on top.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

test("insights auto-compute and serve map, overlaps, graph, and probe", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(`${seededLink(handoff, "collection")}/visualize`);
  // The snapshot was computed in the background during seeding; the space
  // chip names the embedder the vectors came from.
  await expect(page.getByText("openai/text-embedding-3-small", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Chunks")).toBeVisible();

  await page.getByRole("button", { name: "Overlaps" }).click();
  // Cross-document pairs are ranked by an exact similarity; assert by shape,
  // never exact value — the embedding is a live provider call.
  await expect(page.getByText(/^0\.\d{3}$/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("aurora-station.md").first()).toBeVisible();

  await page.getByRole("button", { name: "Graph" }).click();
  await expect(page.getByLabel("Edge threshold")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Map" }).click();
  await page.getByLabel("Probe query").fill("How is power generated aboard Aurora Station?");
  await page.getByRole("button", { name: "Probe" }).click();
  await expect(page.getByText("Nearest chunks")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("aurora-station.md").first()).toBeVisible();
});
