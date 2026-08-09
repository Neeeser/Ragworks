/**
 * Flow: the create-collection wizard warns about a broken pipeline pairing
 * before the collection exists (scenario: diagnostics-mismatch).
 *
 * 1. Log in via the API and open the collections list.
 * 2. Name a collection, then on the Pipelines step swap the default search
 *    tool for the seeded pipeline that embeds with a different model.
 * 3. Expect the embedding_model_mismatch finding on the step, with Next still
 *    enabled — the warning is advisory.
 * 4. Expect the same finding on the Review step, beside an enabled Create.
 */
import { expect, test } from "@playwright/test";

import { loginViaApi } from "../helpers";

/** Matches the seeded "Retrieval (divergent embedding)" pipeline option. */
const divergentTool = /divergent embedding/;

test("the wizard warns about a mismatched pairing before the collection is created", async ({
  page,
}) => {
  await loginViaApi(page);
  await page.goto("/collections");

  await page.getByRole("button", { name: "New collection" }).click();
  await page.getByPlaceholder("Research vault").fill("Preview check");
  await page.getByRole("button", { name: /Next/ }).click();

  // The default search tool matches ingestion; swapping it in introduces the
  // mismatch the seeded pipeline carries.
  await page.getByRole("button", { name: "Remove Hybrid Search" }).click();
  await page.getByRole("button", { name: "Search tool to add" }).click();
  await page.getByRole("option", { name: divergentTool }).click();
  await page.getByRole("button", { name: /Add tool/ }).click();

  await expect(page.getByText("Embedding models differ")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("embedding_model_mismatch")).toBeVisible();
  await expect(page.getByRole("button", { name: /Next/ })).toBeEnabled();

  await page.getByRole("button", { name: /Next/ }).click();
  await expect(page.getByText("Embedding models differ")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Create collection" })).toBeEnabled();
});
