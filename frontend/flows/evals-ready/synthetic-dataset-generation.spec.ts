/**
 * Flow: synthetic eval dataset generation (scenario: evals-ready).
 *
 * 1. Log in via the API and deep-link to /evals.
 * 2. Open the "Generate from collection" wizard; pick the seeded collection
 *    (dataset name auto-fills).
 * 3. Pick a small structured-output chat model from the live catalog.
 * 4. Set a 4-question custom count (Advanced) and generate — this makes
 *    real LLM calls through the seeded OpenRouter connection.
 * 5. Expect the synthetic dataset to appear ready with 4 queries.
 */
import { expect, test } from "@playwright/test";

import { loginViaApi } from "../helpers";

const GENERATION_MODEL = /google\/gemini-3\.5-flash-lite/;

test("generating a synthetic dataset from the seeded collection", async ({ page }) => {
  test.setTimeout(300_000);
  await loginViaApi(page);
  await page.goto("/evals");

  await page.getByRole("button", { name: "Generate from collection" }).click();
  await page.getByRole("combobox", { name: "Collection" }).click();
  await page.getByRole("option", { name: "Sandbox Collection" }).click();
  await expect(page.getByLabel("Dataset name")).toHaveValue(/eval set/);
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await page
    .getByRole("searchbox", { name: "Search models across providers…" })
    .fill("gemini-3.5-flash-lite");
  await page.getByRole("button", { name: GENERATION_MODEL }).first().click();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await page.getByRole("button", { name: "Advanced" }).click();
  await page.getByRole("textbox", { name: "Questions", exact: true }).fill("4");
  await page.getByRole("button", { name: "Generate 4 questions" }).click();

  // The row appears immediately in its "generating" state; ready is signaled
  // by the meta line. The accepted-question count is model-dependent (the
  // grader can reject candidates), so assert shape, not the exact number.
  await expect(page.getByText(/\d+ queries · 3 docs · synthetic/)).toBeVisible({
    timeout: 240_000,
  });
});
