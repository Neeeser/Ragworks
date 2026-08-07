/**
 * Flow: Save version answers an invalid graph (scenario: collection-ready).
 *
 * 1. Log in via the API and open the ingestion pipeline editor. A click selects
 *    a node; the toolbar's Edit is what opens its inspector.
 * 2. Break the semantic indexer by switching its store to Pinecone, which
 *    leaves it naming no index, and apply the edit.
 * 3. Save version opens the dialog on the blocking findings, every one of them
 *    attributed to the node whose config produced it, with the save action
 *    refused.
 * 4. Point the node back at the seeded pgvector index; Save version then opens
 *    the ordinary dialog with the save action available.
 *
 * The canvas is left dirty and never saved, so the seeded pipeline survives
 * for every other spec sharing this state.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

const BLOCKED_NOTICE = "Saving is blocked until these are fixed.";
const INDEX_REQUIRED = /An index is required/;
const SAVE_REVISION = "Save new revision";

test("an invalid graph opens the save dialog on its blocking findings", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(`${handoff.frontend_url}/pipelines/ingestion`);
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });

  // --- break the indexer ----------------------------------------------------
  await page.locator('.react-flow__node:has-text("Semantic Indexer")').click();
  await page.getByRole("button", { name: "Edit node" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible({ timeout: 20_000 });
  await drawer.getByRole("radio", { name: /Pinecone/ }).click();
  await drawer.getByRole("button", { name: "Save node" }).click();
  await expect(page.getByText(/\d+ unsaved/)).toBeVisible({ timeout: 20_000 });

  // --- the save dialog states what blocks it --------------------------------
  await page.getByRole("button", { name: "Save version" }).click();
  const blocked = page.getByRole("dialog");
  await expect(blocked).toBeVisible({ timeout: 20_000 });
  await expect(blocked.getByText(BLOCKED_NOTICE)).toBeVisible();
  // Attributed to the node whose config produced it — the client's finding and
  // the server's alike. A per-node finding with no node attached is one the
  // editor cannot point at, so nothing is grouped under "Pipeline" here.
  await expect(blocked.getByText("Semantic Indexer", { exact: true })).toBeVisible();
  await expect(blocked.getByText(INDEX_REQUIRED)).toBeVisible();
  await expect(blocked.getByText("must specify an index")).toBeVisible({ timeout: 20_000 });
  await expect(blocked.getByText("Pipeline", { exact: true })).toHaveCount(0);
  await expect(blocked.getByRole("button", { name: SAVE_REVISION })).toBeDisabled();
  await blocked.getByRole("button", { name: "Cancel" }).click();

  // --- a valid graph opens the ordinary dialog ------------------------------
  await page.locator('.react-flow__node:has-text("Semantic Indexer")').click();
  await page.getByRole("button", { name: "Edit node" }).click();
  const reopened = page.getByRole("dialog");
  await reopened.getByRole("radio", { name: /pgvector/ }).click();
  await reopened.getByRole("combobox", { name: "Vector index" }).click();
  await page
    .getByRole("option", { name: /ragworks/ })
    .first()
    .click();
  await reopened.getByRole("button", { name: "Save node" }).click();

  await page.getByRole("button", { name: "Save version" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByText(BLOCKED_NOTICE)).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: SAVE_REVISION })).toBeEnabled();
});
