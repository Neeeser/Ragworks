/**
 * Flow: the eval run wizard's scope step tells the truth (scenario: evals-ready).
 *
 * 1. Log in via the API and open the evals page.
 * 2. Start a run against the seeded dataset and its default pipelines.
 * 3. The scope step offers only the cutoffs the retrieval pipeline can serve:
 *    a stock pipeline returns ten results, so @20 and deeper are unavailable
 *    rather than selected-and-doomed, and the text names what caps them.
 * 4. Preset scope describes what the seeded dataset actually holds, instead of
 *    a fixed ceiling the run could never reach.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

test("the scope step offers only cutoffs the pipeline can score", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(`${handoff.frontend_url}/evals`);
  await page.getByRole("button", { name: "New run" }).first().click();

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Dataset" }).click();
  await page.getByRole("option").first().click();
  await dialog.getByRole("button", { name: "Next" }).click();

  await dialog.getByRole("combobox", { name: "Ingestion pipeline" }).click();
  await page.getByRole("option").first().click();
  await dialog.getByRole("combobox", { name: "Retrieval pipeline" }).click();
  await page.getByRole("option").first().click();
  await dialog.getByRole("button", { name: "Next" }).click();

  // The default retrieval pipeline binds result_limit to 10, so anything
  // deeper can only ever be scored as a miss.
  await expect(dialog.getByRole("button", { name: "@10", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(dialog.getByRole("button", { name: "@25", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "@25", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(dialog.getByText(/caps results at 10/)).toBeVisible();

  // The seeded dataset holds three queries, so every preset clamps to it —
  // the point is that none of them promises a scope the run cannot deliver.
  const scope = dialog.getByRole("radiogroup", { name: "Run scope" });
  await expect(scope.getByRole("radio", { name: /Quick/ })).toContainText(/\d+ quer(y|ies)/);
  await expect(scope.getByRole("radio", { name: /Quick/ })).not.toContainText("50 queries");
});
