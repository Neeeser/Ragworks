/**
 * Flow: the described-images intake collects a vision model and wires it into
 * the graph (scenario: collection-ready).
 *
 * 1. Log in via the API and open the Ingestion pipelines page.
 * 2. Name a pipeline and pick an embedding model: the wizard can move on.
 * 3. Choose "Text + described images": a vision-model picker appears and the
 *    step gates until a chat model is chosen, because the vision shell
 *    refuses to run without one.
 * 4. Pick a chat model that states image input, point the pipeline at the
 *    seeded index, and create it.
 * 5. Read the created definition back: the vision shell carries the chosen
 *    model and the shipped describe preset's output field, and both indexers
 *    read its output rather than the chunker's — a description that reached
 *    only the vector store would be absent from every lexical ranking.
 */
import { expect, test, type Page } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

const DESCRIBED_INTAKE = "Text + described images";
const DENSE_INDEX = "ragworks";
const PIPELINE_NAME = "Described images ingestion";

const intakeCard = (page: Page, label: string) =>
  page.getByRole("radio").filter({ hasText: label });

/** The first chat model the catalog marks as reading images. */
async function pickVisionModel(page: Page): Promise<void> {
  const search = page.getByPlaceholder(/Search chat models/);
  await expect(search).toBeVisible();
  await search.fill("gpt-4o-mini");
  const row = page.getByRole("button").filter({ hasText: "Image input (vision)" }).first();
  await row.click();
}

test("the described-images intake wires a vision model into both indexes", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto("/pipelines/ingestion");
  const newPipeline = page.getByRole("button", { name: "New pipeline" });
  // The console exchanges the refresh cookie on its first load; a navigation
  // that raced it lands on sign-in, and reloading picks the session up.
  const ready = await newPipeline
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!ready) await page.goto("/pipelines/ingestion");
  await newPipeline.click();

  await page.getByPlaceholder(/Research library/).fill(PIPELINE_NAME);
  await page.getByRole("button", { name: /^Next/ }).click();

  await page
    .getByRole("button")
    .filter({ hasText: "openai/text-embedding-3-small" })
    .first()
    .click();
  await expect(page.getByRole("button", { name: /^Next/ })).toBeEnabled();

  // The preset that describes images asks for the model that reads them, and
  // gates the step until it has one.
  await intakeCard(page, DESCRIBED_INTAKE).click();
  // The preset card's own hint mentions a vision model too, so match the
  // section label exactly rather than the phrase.
  await expect(page.getByText("Vision model", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Next/ })).toBeDisabled();

  await pickVisionModel(page);
  await expect(page.getByRole("button", { name: /^Next/ })).toBeEnabled();

  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByRole("radio").filter({ hasText: "Existing index" }).click();
  await page.getByRole("combobox", { name: /pgvector.*index/i }).click();
  await page
    .getByRole("option")
    .filter({ hasText: `${DENSE_INDEX} ·` })
    .click();
  await page.getByRole("button", { name: /^Next/ }).click();

  await expect(page.getByText(DESCRIBED_INTAKE)).toBeVisible();
  await page.getByRole("button", { name: "Create pipeline" }).click();
  await expect(page.getByText("Pipeline created.")).toBeVisible();

  const api = page.context().request;
  const listed = await api.get(`${handoff.backend_url}/api/pipelines?kind=ingestion`, {
    headers: { Authorization: `Bearer ${handoff.token}` },
  });
  const pipelines = (await listed.json()) as {
    name: string;
    definition: {
      nodes: { id: string; type: string; config: Record<string, unknown> }[];
      edges: { source: string; target: string }[];
    };
  }[];
  const created = pipelines.find((pipeline) => pipeline.name === PIPELINE_NAME);
  const definition = created?.definition;
  const describe = definition?.nodes.find((node) => node.type === "llm.describe");
  expect(describe?.config.model_name).toBeTruthy();
  expect(describe?.config.output_fields).toBeTruthy();

  const indexers = definition!.nodes.filter((node) => node.type.startsWith("indexer."));
  expect(indexers.length).toBe(2);
  const embedder = definition!.nodes.find((node) => node.type === "embedder.text")!;
  const bm25 = definition!.nodes.find((node) => node.type === "indexer.bm25")!;
  for (const target of [embedder.id, bm25.id]) {
    expect(
      definition!.edges.some((edge) => edge.source === describe!.id && edge.target === target),
    ).toBe(true);
  }
});
