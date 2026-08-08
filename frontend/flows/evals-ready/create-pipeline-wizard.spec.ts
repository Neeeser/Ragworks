/**
 * Flow: the create-pipeline wizard adapts to the template it is building
 * (scenario: evals-ready).
 *
 * 1. Log in via the API and open the Tools pipelines page.
 * 2. Open the wizard: the name field carries the chosen template's label,
 *    and the steps beyond the first unfilled one are not reachable.
 * 3. Switch to Count matches: the name follows the new template, the
 *    embedding step disappears, and the store step asks for a BM25 index —
 *    offering the seeded sparse index and not its dense sibling.
 * 4. Create it, and confirm the aggregate node reads the BM25 index directly.
 * 5. Back on the semantic template, the embedding step pre-selects the model
 *    the chosen index was written with, badged as such.
 * 6. Type a name of your own: switching templates then leaves it alone.
 */
import { expect, test, type Page } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

const SEMANTIC = "Semantic + keyword search";
const COUNT = "Count matches";
const DENSE_INDEX = "ragworks";
const SPARSE_INDEX = "ragworks-bm25";

const nameField = (page: Page) => page.getByPlaceholder(/Research library/);

/** Template cards carry their description too, and one label holds a regex
 * metacharacter — match on contained text rather than an accessible name. */
const templateCard = (page: Page, label: string) =>
  page.getByRole("radio").filter({ hasText: label });

const indexOption = (page: Page, name: string) =>
  page.getByRole("option").filter({ hasText: name });

async function openWizard(page: Page): Promise<void> {
  await page.goto("/pipelines/tools");
  const newPipeline = page.getByRole("button", { name: "New pipeline" });
  // The console exchanges the refresh cookie on its first load; a navigation
  // that raced that exchange lands on sign-in, and reloading picks the
  // established session up rather than waiting out the click's timeout.
  const ready = await newPipeline
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!ready) await page.goto("/pipelines/tools");
  await newPipeline.click();
  await expect(templateCard(page, SEMANTIC)).toBeChecked();
}

async function chooseTemplate(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: /Template/ }).click();
  await templateCard(page, label).click();
  await page.getByRole("button", { name: /^Next/ }).click();
}

test("the wizard names, gates, and points each template at the store it reads", async ({
  page,
}) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  await openWizard(page);

  // The review step is unreachable until the store step has an index.
  await expect(page.getByRole("button", { name: /Review/ })).toBeDisabled();

  await page.getByRole("button", { name: /^Next/ }).click();
  await expect(nameField(page)).toHaveValue(SEMANTIC);

  // Switching templates re-seeds the suggested name and re-shapes the steps:
  // an aggregate tool embeds nothing, so it collects no embedding model.
  await chooseTemplate(page, COUNT);
  await expect(nameField(page)).toHaveValue(COUNT);
  await expect(page.getByRole("button", { name: /Embedding/ })).toHaveCount(0);

  await page.getByRole("button", { name: /^Next/ }).click();
  const indexPicker = page.getByRole("combobox", { name: /BM25 index/i });
  await expect(indexPicker).toBeVisible();
  await indexPicker.click();
  await expect(indexOption(page, SPARSE_INDEX)).toBeVisible();
  // The dense sibling is not offered: this graph never reads it.
  await expect(indexOption(page, `${DENSE_INDEX} ·`)).toHaveCount(0);
  await indexOption(page, SPARSE_INDEX).click();

  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByRole("button", { name: "Create pipeline" }).click();
  await expect(page.getByText("Pipeline created.")).toBeVisible();

  // The created graph reads the BM25 index it was pointed at, with no
  // sibling derivation in between.
  const api = page.context().request;
  const listed = await api.get(`${handoff.backend_url}/api/pipelines?kind=retrieval`, {
    headers: { Authorization: `Bearer ${handoff.token}` },
  });
  const pipelines = (await listed.json()) as {
    name: string;
    definition: { nodes: { type: string; config: Record<string, unknown> }[] };
  }[];
  const created = pipelines.find((pipeline) => pipeline.name === COUNT);
  const aggregate = created?.definition.nodes.find((node) => node.type === "count.bm25");
  expect(aggregate?.config.index_name).toBe(SPARSE_INDEX);
});

test("the embedding step suggests the model the chosen index was written with", async ({
  page,
}) => {
  await loginViaApi(page);
  await openWizard(page);
  const dialog = page.getByRole("dialog");

  await page.getByRole("button", { name: /^Next/ }).click();
  await expect(nameField(page)).toHaveValue(SEMANTIC);
  await page.getByRole("button", { name: /^Next/ }).click();

  const indexPicker = page.getByRole("combobox", { name: /pgvector.*index/i });
  await expect(indexPicker).toBeVisible();
  await indexPicker.click();
  await indexOption(page, `${DENSE_INDEX} ·`).click();
  await expect(indexPicker).toContainText(DENSE_INDEX);
  await page.getByRole("button", { name: /^Next/ }).click();

  // The seeded ingestion pipeline writes this index; its embedder is what a
  // query pipeline has to match, so the wizard arrives with it chosen.
  await expect(dialog).toContainText("The model that embeds queries.");
  await expect(dialog.getByText("Wrote this index")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Next/ })).toBeEnabled();
});

test("a hand-typed name survives a template switch", async ({ page }) => {
  await loginViaApi(page);
  await openWizard(page);

  await page.getByRole("button", { name: /^Next/ }).click();
  await nameField(page).fill("My own tool");

  await chooseTemplate(page, COUNT);

  await expect(nameField(page)).toHaveValue("My own tool");
});
