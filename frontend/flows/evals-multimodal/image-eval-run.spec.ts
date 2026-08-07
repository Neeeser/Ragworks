/**
 * Flow: measuring an image corpus (scenario: evals-multimodal).
 *
 * 1. Log in via the API (auth is not the subject) and open the seeded run.
 *    It completed, every image corpus document reached the index, and the
 *    image query was evaluated beside the text ones — the three facts that
 *    are only true if media survived materialization, ingestion, and
 *    retrieval.
 * 2. Open the dataset behind it: its records carry image media instead of
 *    text, which the queries table and the corpus rows both state, and the
 *    ingested corpus is the multimodal pipeline's.
 * 3. Start another run over the same dataset from the wizard. It reuses the
 *    already-ingested corpus, so what this exercises is a user launching an
 *    eval over an image dataset and getting scores back.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

test("the seeded run scored the image corpus with nothing lost to ingestion", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(seededLink(handoff, "image eval run"));
  await expect(page.getByText("Completed", { exact: true })).toBeVisible({ timeout: 30_000 });

  // Both alerts are corpus outcomes, not retrieval ones: either would mean an
  // image corpus document never became an indexed chunk.
  await expect(page.getByText(/corpus documents indexed/)).toHaveCount(0);
  await expect(page.getByText(/no gold document reached the index/)).toHaveCount(0);

  // Aggregates exist rather than the empty-state line, and every query in the
  // dataset — the image one included — produced a row. The scores themselves
  // are a live model outcome and are not asserted.
  await expect(page.getByText("Metrics land as queries complete.")).toHaveCount(0);
  await expect(page.getByText(/\d+ evaluated/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand query q5" })).toBeVisible();
});

test("the dataset states that its records are images", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(seededLink(handoff, "image eval dataset"));

  // The image query has no text to show, so the row names what it carries —
  // and there is nothing to edit.
  await expect(page.getByText(/image\/jpeg · \d+×\d+/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Edit query q5" })).toBeDisabled();

  // The corpus was ingested by the multimodal pipeline, whole.
  const corpora = page.getByRole("navigation", { name: "Ingested corpora" });
  await expect(corpora.getByRole("button", { name: /Multimodal embedding/ })).toContainText("4/4");

  // A corpus document expands to its media rather than to stored text.
  await page.getByRole("button", { name: "Expand document galactic-center" }).click();
  await expect(page.getByText(/image\/jpeg · \d+×\d+/).nth(1)).toBeVisible();
});

test("a run over the image dataset starts from the wizard and completes", async ({ page }) => {
  // Provisioning is cached on the seeded run's corpus, so this is a query
  // pass — but it still runs a real model per query.
  test.setTimeout(300_000);
  await loginViaApi(page);

  await page.goto("/evals");
  await page.getByRole("button", { name: "New run" }).first().click();

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Dataset" }).click();
  await page.getByRole("option", { name: /Sandbox Image Eval Dataset/ }).click();
  await dialog.getByRole("button", { name: "Next", exact: true }).click();

  // The image corpus is only readable by the pipeline that parses image
  // files; the stock ingestion pipeline would fail every document.
  await dialog.getByRole("combobox", { name: "Ingestion pipeline" }).click();
  await page.getByRole("option", { name: "Multimodal embedding" }).click();
  await dialog.getByRole("combobox", { name: "Retrieval pipeline" }).click();
  await page.getByRole("option", { name: "Default Retrieval Pipeline" }).click();
  await dialog.getByRole("button", { name: "Next", exact: true }).click();

  await dialog.getByRole("button", { name: "Start run" }).click();

  // The wizard lands on the new run's page; it settles once every sampled
  // query has been scored.
  await expect(page.getByText("Completed", { exact: true })).toBeVisible({ timeout: 240_000 });
  await expect(page.getByText(/\d+ evaluated/)).toBeVisible();
});
