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

type CatalogModel = { id: string; input_modalities: string[] | null };

/**
 * A model the connected provider states reads images, read from the catalog at
 * run time — a model id pinned here goes stale the day a provider retires it,
 * and turns the suite red on a selector rather than on behaviour.
 */
async function imageCapableModel(
  page: Page,
  backendUrl: string,
  token: string,
  kind: "chat" | "embedding",
): Promise<CatalogModel> {
  const response = await page.context().request.get(`${backendUrl}/api/models?kind=${kind}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const catalog = (await response.json()) as { models: CatalogModel[] };
  const match = catalog.models.find((model) => (model.input_modalities ?? []).includes("image"));
  expect(match, `the connected provider publishes an image-capable ${kind} model`).toBeTruthy();
  return match as CatalogModel;
}

/**
 * Pick a model out of a `ModelPickerInline`. The picker opens on Pinned or
 * Recent once this account has used one and only the All tab carries the
 * search box, so select the tab rather than assuming which one is showing.
 * `which` picks between the two pickers this step renders — the embedding one
 * first, the vision one below it.
 */
async function pickFromPicker(
  page: Page,
  which: "first" | "last",
  searchPlaceholder: RegExp,
  modelId: string,
): Promise<void> {
  const allTabs = page.getByRole("button", { name: "All", exact: true });
  await (which === "first" ? allTabs.first() : allTabs.last()).click();
  await page.getByPlaceholder(searchPlaceholder).fill(modelId);
  await page.getByRole("button").filter({ hasText: modelId }).first().click();
}

test("the described-images intake wires a vision model into both indexes", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  const token = handoff.token as string;
  const visionModel = await imageCapableModel(page, handoff.backend_url, token, "chat");

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

  // Any embedding model does here: this intake hands the embedder text.
  await pickFromPicker(page, "first", /Search embedding models/, "openai/text-embedding-3-small");
  await expect(page.getByRole("button", { name: /^Next/ })).toBeEnabled();

  // The preset that describes images asks for the model that reads them, and
  // gates the step until it has one.
  await intakeCard(page, DESCRIBED_INTAKE).click();
  // The preset card's own hint mentions a vision model too, so match the
  // section label exactly rather than the phrase.
  await expect(page.getByText("Vision model", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Next/ })).toBeDisabled();

  await pickFromPicker(page, "last", /Search chat models/, visionModel.id);
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
  // The node-library endpoint points a preset at the account's shipped library
  // prompt where it has one and leaves the inline text where it does not, so
  // what matters is that the shell has something to ask.
  expect(describe?.config.prompt_ref ?? describe?.config.prompt).toBeTruthy();
  // An empty field list is the state the shell refuses to save on, so count
  // the fields rather than asking whether the key is set.
  expect(describe?.config.output_fields as unknown[]).toHaveLength(1);

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
