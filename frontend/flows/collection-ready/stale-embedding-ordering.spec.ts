/**
 * Flow: the editor reports an embedding invalidated by a later content rewrite
 * (scenario: collection-ready).
 *
 * 1. Log in via the API and open the seeded ingestion pipeline.
 * 2. Rewire it, one edge drag at a time, from parse → chunk → embed → index
 *    into parse → embed → chunk → index: chunking now runs *after* embedding,
 *    so every chunk the indexer receives was split out of text the vector was
 *    computed from and no longer describes.
 * 3. Saving refuses and names the indexer: the chunker's output no longer
 *    carries the embedding it used to claim.
 *
 * Each intermediate state is deliberately sound, so an error appearing early
 * would be a false positive rather than the finding under test. The save is
 * refused before any dialog opens, so the seeded pipeline is left untouched.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

const handle = (nodeId: string, side: "source" | "target") =>
  `[data-id$="-${nodeId}-items-${side}"]`;

test("chunking after embedding is reported on the indexer", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(`${handoff.frontend_url}/pipelines/ingestion`);
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });

  const indexer = page.locator('.react-flow__node:has-text("Semantic Indexer")');
  await expect(indexer).toBeVisible();

  // The seeded ordering is sound, so nothing is reported before the rewiring.
  await expect(page.getByText(/no embedding items can reach it/)).toHaveCount(0);

  // 1. Feed the embedder from the parser instead of the chunker.
  await page
    .locator(handle("parse-text", "source"))
    .dragTo(page.locator(handle("embed-chunks", "target")));
  // 2. Feed the chunker from the embedder — chunking now follows embedding.
  await page
    .locator(handle("embed-chunks", "source"))
    .dragTo(page.locator(handle("chunk-document", "target")));
  // 3. Point the semantic indexer at the chunks rather than the embedder.
  await page
    .locator(handle("chunk-document", "source"))
    .dragTo(page.locator(handle("index-chunks", "target")));

  await expect(page.getByText(/\d+ unsaved/)).toBeVisible();

  // The rewired graph reaches the user as a refusal to save, naming the node
  // that can no longer do its job rather than the edge that broke it.
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByText(/no embedding items can reach it/).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
