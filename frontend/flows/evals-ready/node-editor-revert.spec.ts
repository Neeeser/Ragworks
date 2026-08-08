/**
 * Flow: reverting a node edit leaves the drawer clean (scenario: evals-ready).
 *
 * 1. Clear the Semantic Indexer's index and pick the same one again. The picker
 *    deletes and re-appends the config keys, and writes the registry dimension
 *    that a server-built pipeline never stored — neither is a change the user
 *    made, so closing is silent.
 * 2. The BM25 Indexer, where no dimension is written and only the key order
 *    differs, closes silently too.
 * 3. Renaming a node still asks to discard, so the check can't pass by never
 *    prompting.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

const INGESTION_EDITOR = "/pipelines/ingestion";
const SEMANTIC_INDEXER = "index-chunks";
const BM25_INDEXER = "index-bm25";
const BM25_INDEX = "ragworks-bm25";
const SEMANTIC_INDEX = "ragworks";
const INDEX_SELECT = "Vector index";
const CLEAR_INDEX = "Select an index";
const CLOSE_EDITOR = "Close node editor";
const DISCARD_PROMPT = "Discard node edits?";

type Page = import("@playwright/test").Page;

const openNode = async (page: Page, nodeId: string) => {
  await page.locator(`.react-flow__node[data-id="${nodeId}"]`).dblclick();
  await expect(page.getByRole("dialog")).toBeVisible();
};

/** Options print the index name plus its dimension, so match on the name. */
const pickIndex = async (page: Page, option: string) => {
  await page.getByRole("combobox", { name: INDEX_SELECT }).click();
  await page.getByRole("listbox").getByRole("option").filter({ hasText: option }).first().click();
};

/** Clear the index and choose the same one again, then close the drawer. */
const revertIndex = async (page: Page, nodeId: string, index: string) => {
  await openNode(page, nodeId);
  await pickIndex(page, CLEAR_INDEX);
  await pickIndex(page, index);
  await page.getByRole("button", { name: CLOSE_EDITOR }).click();
};

test("an index cleared and re-picked closes without a discard prompt", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(`${handoff.frontend_url}${INGESTION_EDITOR}`);
  await expect(page.locator(`.react-flow__node[data-id="${SEMANTIC_INDEXER}"]`)).toBeVisible({
    timeout: 30_000,
  });

  await revertIndex(page, SEMANTIC_INDEXER, SEMANTIC_INDEX);
  await expect(page.getByText(DISCARD_PROMPT)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await revertIndex(page, BM25_INDEXER, BM25_INDEX);
  await expect(page.getByText(DISCARD_PROMPT)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // A change the user did make is still confirmed.
  await openNode(page, SEMANTIC_INDEXER);
  await page.getByLabel("Node label").fill("Semantic Indexer renamed");
  await page.getByRole("button", { name: CLOSE_EDITOR }).click();
  await expect(page.getByText(DISCARD_PROMPT)).toBeVisible();
});
