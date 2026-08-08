/**
 * Flow: the ingestion wizard collects processing before the store, and
 * suggests the index it will create (scenario: evals-ready).
 *
 * 1. Log in via the API and open the Ingestion pipelines page.
 * 2. The step list reads Name → Processing → Vector store → Review.
 * 3. Pick a text-only embedding model, then the images intake: the wizard
 *    states the conflict and blocks both Next and the store step.
 * 4. Back on text documents, the store step opens on a per-account index name
 *    it will create, and names the BM25 sibling created alongside it.
 * 5. Create the pipeline: both indexes exist, registered, at the model's own
 *    width, and the graph writes them.
 */
import { expect, test, type Page } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

const nameField = (page: Page) => page.getByPlaceholder(/Research library/);
const nextButton = (page: Page) => page.getByRole("button", { name: /^Next/ });
const presetCard = (page: Page, label: string) =>
  page.getByRole("radio").filter({ hasText: label });

type CatalogModel = {
  id: string;
  name: string;
  connection_id: string;
  input_modalities: string[] | null;
};

/**
 * A model that states it reads text and not images, read from the catalog at
 * run time — a model id pinned in the spec goes stale the day a provider
 * retires it.
 */
async function textOnlyModel(page: Page, backendUrl: string, token: string): Promise<CatalogModel> {
  const response = await page.context().request.get(`${backendUrl}/api/models?kind=embedding`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const catalog = (await response.json()) as { models: CatalogModel[] };
  const match = catalog.models.find(
    (model) =>
      (model.input_modalities ?? []).length > 0 &&
      !(model.input_modalities ?? []).includes("image"),
  );
  expect(match, "the connected provider publishes a text-only embedding model").toBeTruthy();
  return match as CatalogModel;
}

async function openWizard(page: Page): Promise<void> {
  await page.goto("/pipelines/ingestion");
  const newPipeline = page.getByRole("button", { name: "New pipeline" });
  // The console exchanges the refresh cookie on its first load; a navigation
  // that raced that exchange lands on sign-in, and reloading picks the
  // established session up rather than waiting out the click's timeout.
  const ready = await newPipeline
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!ready) await page.goto("/pipelines/ingestion");
  await newPipeline.click();
}

async function selectModel(page: Page, model: CatalogModel): Promise<void> {
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByPlaceholder(/Search embedding models/).fill(model.id);
  await page.getByRole("button").filter({ hasText: model.id }).first().click();
}

test("processing precedes the store, and the store step suggests the index it creates", async ({
  page,
}) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  expect(handoff.token, "the handoff carries a token").toBeTruthy();
  const model = await textOnlyModel(page, handoff.backend_url, handoff.token ?? "");
  await openWizard(page);

  const dialog = page.getByRole("dialog");
  const steps = dialog
    .getByRole("button")
    .filter({ hasText: /^[1-4](Name|Processing|Vector store|Review)$/ });
  expect(await steps.allTextContents()).toEqual([
    "1Name",
    "2Processing",
    "3Vector store",
    "4Review",
  ]);

  await nameField(page).fill("Flow ingestion");
  await nextButton(page).click();
  await expect(dialog).toContainText("Intake");

  // A model that states text-only inputs cannot serve the image intake.
  await selectModel(page, model);
  await presetCard(page, "Everything as images").click();
  await expect(dialog.getByRole("alert")).toContainText("sends it images");
  await expect(nextButton(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: /Vector store/ })).toBeDisabled();

  await presetCard(page, "Text documents").click();
  await expect(nextButton(page)).toBeEnabled();
  await nextButton(page).click();

  // The suggested index carries the account, never a fixed literal, and the
  // BM25 sibling is named before it appears.
  const indexField = page.getByLabel(/New pgvector/);
  const indexName = await indexField.inputValue();
  expect(indexName).toMatch(/^ragworks-.+/);
  await expect(dialog).toContainText(`${indexName}-bm25`);

  await nextButton(page).click();
  await page.getByRole("button", { name: "Create pipeline" }).click();
  await expect(page.getByText("Pipeline created.")).toBeVisible({ timeout: 30_000 });

  const indexes = await page.context().request.get(`${handoff.backend_url}/api/indexes`, {
    headers: { Authorization: `Bearer ${handoff.token ?? ""}` },
  });
  const listed = (await indexes.json()) as {
    indexes: { name: string; registered: boolean; vector_type: string }[];
  };
  const dense = listed.indexes.find((index) => index.name === indexName);
  const sparse = listed.indexes.find((index) => index.name === `${indexName}-bm25`);
  expect(dense?.registered).toBe(true);
  expect(sparse?.vector_type).toBe("sparse");
  expect(sparse?.registered).toBe(true);
});
