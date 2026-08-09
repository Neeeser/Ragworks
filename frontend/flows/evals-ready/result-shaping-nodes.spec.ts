/**
 * Flow: the result-shaping nodes reach the canvas and shape a real run
 * (scenario: evals-ready).
 *
 * 1. Log in via the API and open the seeded search tool's editor.
 * 2. The palette's Ranking section offers Deduplicate Results and Score
 *    Threshold, and each drawer states what the node does — the catalog and
 *    inspector are derived from the node spec, so a node registered without a
 *    description or an inspector-visible config field surfaces here.
 * 3. Adding both from the drawer puts them on the canvas.
 * 4. Score Threshold's inspector renders its Minimum score field.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

const RETRIEVAL_PIPELINE = /Hybrid Search/;
const RETRIEVAL_EDITOR = "/pipelines/tools";

const openCatalogEntry = async (page: import("@playwright/test").Page, label: string) => {
  await page.getByRole("tab", { name: "Nodes" }).click();
  await page.getByPlaceholder("Search nodes").fill(label);
  await page.getByRole("button", { name: label, exact: true }).click();
};

test("the palette offers the result-shaping nodes and adds them to the canvas", async ({
  page,
}) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(`${handoff.frontend_url}${RETRIEVAL_EDITOR}`);
  await expect(page.getByText(RETRIEVAL_PIPELINE).first()).toBeVisible({ timeout: 30_000 });

  await openCatalogEntry(page, "Deduplicate Results");
  const dedupe = page.getByRole("dialog");
  await expect(dedupe.getByText("Ranking", { exact: true })).toBeVisible();
  await expect(dedupe.getByText(/Keep one occurrence of each retrieved chunk/)).toBeVisible();
  await dedupe.getByRole("button", { name: "Add to canvas" }).click();
  await expect(page.locator('.react-flow__node:has-text("Deduplicate Results")')).toHaveCount(1);

  await openCatalogEntry(page, "Score Threshold");
  const threshold = page.getByRole("dialog");
  await expect(
    threshold.getByText(/Keep only the results scoring at or above a minimum/),
  ).toBeVisible();
  await expect(threshold.getByText("Minimum score")).toBeVisible();
  await threshold.getByRole("button", { name: "Add to canvas" }).click();
  await expect(page.locator('.react-flow__node:has-text("Score Threshold")')).toHaveCount(1);
});
