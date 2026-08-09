/**
 * Flow: a collection is created from explicit pipeline choices, and keeps them
 * (scenario: collection-ready).
 *
 * 1. Log in via the API (auth is not the subject) and open the collections list.
 * 2. Open the create wizard, name the collection, and reach the Pipelines step.
 * 3. Expect nothing preselected — no ingestion pipeline, no tool — with Next
 *    and the Review step both gated, because a collection runs what it was
 *    created with for its whole life.
 * 4. Choose an ingestion pipeline; Next stays gated until a tool is added too.
 * 5. Add the search tool, create, and expect the new collection listed.
 * 6. On its overview, expect Remove disabled on the only tool: the single tool
 *    is replaced, never removed.
 */
import { expect, test } from "@playwright/test";

import { loginViaApi } from "../helpers";

const INGESTION_PICKER = "Ingestion pipeline";
const TOOL_PICKER = "Search tool to add";
const COLLECTION_NAME = "Explicit Choices";

test("the create wizard requires both pipeline choices, and the tool it binds stays", async ({
  page,
}) => {
  await loginViaApi(page);
  await page.goto("/collections");

  await page.getByRole("button", { name: "New collection" }).click();
  await page.getByPlaceholder("Research vault").fill(COLLECTION_NAME);
  await page.getByRole("button", { name: /Next/ }).click();

  // Nothing is chosen for the user, so the step cannot be passed yet.
  await expect(page.getByRole("button", { name: INGESTION_PICKER })).toHaveText(
    /Select a pipeline/,
  );
  await expect(page.getByText("Add at least one search tool for chat to call.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Next/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /3\s*Review/ })).toBeDisabled();

  await page.getByRole("button", { name: INGESTION_PICKER }).click();
  await page.getByRole("option").first().click();
  await expect(page.getByRole("button", { name: /Next/ })).toBeDisabled();

  await page.getByRole("button", { name: TOOL_PICKER }).click();
  await page.getByRole("option").first().click();
  await page.getByRole("button", { name: /Add tool/ }).click();
  await expect(page.getByRole("button", { name: /Next/ })).toBeEnabled();

  await page.getByRole("button", { name: /Next/ }).click();
  await page.getByRole("button", { name: "Create collection" }).click();

  // The list renders rows as divs, not a table, so match the name itself.
  const created = page.getByText(COLLECTION_NAME, { exact: true });
  await expect(created).toBeVisible({ timeout: 20_000 });

  await created.click();
  const remove = page.getByRole("button", { name: "Remove" });
  await expect(remove).toBeVisible({ timeout: 20_000 });
  await expect(remove).toBeDisabled();
});
