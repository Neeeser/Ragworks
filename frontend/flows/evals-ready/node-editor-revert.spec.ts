/**
 * Flow: reverting a node edit leaves the drawer clean (scenario: evals-ready).
 *
 * Clearing the BM25 Indexer's index and re-picking the same one deletes and
 * re-appends the config keys, so the rebuilt config differs from the node's
 * only in key order. Closing must then be silent; changing the node's label
 * must still be confirmed, so the check can't pass by never prompting.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

const INGESTION_EDITOR = "/pipelines/ingestion";
const BM25_INDEXER = "index-bm25";
const BM25_INDEX_NAME = "ragworks-bm25";
const INDEX_SELECT = "Vector index";
const CLOSE_EDITOR = "Close node editor";
const DISCARD_PROMPT = "Discard node edits?";

const openIndexer = async (page: import("@playwright/test").Page) => {
  await page.locator(`.react-flow__node[data-id="${BM25_INDEXER}"]`).dblclick();
  await expect(page.getByRole("dialog")).toBeVisible();
};

const pickIndex = async (page: import("@playwright/test").Page, option: string) => {
  await page.getByRole("combobox", { name: INDEX_SELECT }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
};

test("an index cleared and re-picked closes without a discard prompt", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(`${handoff.frontend_url}${INGESTION_EDITOR}`);
  await expect(page.locator(`.react-flow__node[data-id="${BM25_INDEXER}"]`)).toBeVisible({
    timeout: 30_000,
  });

  await openIndexer(page);
  await pickIndex(page, "Select an index");
  await pickIndex(page, BM25_INDEX_NAME);
  await page.getByRole("button", { name: CLOSE_EDITOR }).click();
  await expect(page.getByText(DISCARD_PROMPT)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // A change the user did make is still confirmed.
  await openIndexer(page);
  await page.getByLabel("Node label").fill("BM25 Indexer renamed");
  await page.getByRole("button", { name: CLOSE_EDITOR }).click();
  await expect(page.getByText(DISCARD_PROMPT)).toBeVisible();
});
