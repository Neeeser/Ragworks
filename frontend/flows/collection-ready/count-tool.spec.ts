/**
 * Flow: a structured count tool runs from the search page
 * (scenario: collection-ready).
 *
 * 1. Log in via the API and, through the tools API, bind a count pipeline
 *    (query input → count.bm25 over the seeded BM25 index → tool.output)
 *    to the seeded collection — pipeline authoring UI is not the subject.
 * 2. Open the collection search page and pick the count tool in the picker.
 * 3. Run a query and expect a structured result: named count fields with
 *    numeric values instead of chunk cards.
 * 4. Unbind the tool so the tools-panel spec sees the seeded state.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

const COUNT_DEFINITION = {
  nodes: [
    {
      id: "query-input",
      type: "retrieval.input",
      name: "Input",
      config: {
        tool_name: "count_matches",
        tool_description: "Count documents and chunks mentioning the query terms.",
      },
    },
    {
      id: "count",
      type: "count.bm25",
      name: "Count",
      config: { backend: "pgvector", index_name: "ragworks-bm25" },
    },
    { id: "tool-output", type: "tool.output", name: "Output" },
  ],
  edges: [
    {
      id: "e1",
      source: "query-input",
      target: "count",
      source_port: "request",
      target_port: "request",
    },
    {
      id: "e2",
      source: "count",
      target: "tool-output",
      source_port: "values",
      target_port: "values",
    },
  ],
};

test("a bound count tool returns structured counts on the search page", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  const collectionUrl = seededLink(handoff, "collection");
  const collectionId = new URL(collectionUrl).pathname.split("/").pop() ?? "";
  const api = page.context().request;
  const headers = { Authorization: `Bearer ${handoff.token}` };

  const pipelineResponse = await api.post(`${handoff.backend_url}/api/pipelines`, {
    headers,
    data: { name: "Count matches (flow)", definition: COUNT_DEFINITION },
  });
  expect(pipelineResponse.ok()).toBe(true);
  const pipeline = (await pipelineResponse.json()) as { id: string };

  const bindResponse = await api.post(
    `${handoff.backend_url}/api/collections/${collectionId}/tools`,
    { headers, data: { pipeline_id: pipeline.id } },
  );
  expect(bindResponse.ok()).toBe(true);
  const binding = (await bindResponse.json()) as { id: string };

  try {
    await page.goto(`${collectionUrl}/search`);

    await page.getByRole("combobox", { name: "Tool to run" }).click();
    await page.getByRole("option", { name: /count_matches/ }).click();

    await page.getByRole("textbox", { name: "Search query" }).fill("aurora station");
    await page.getByRole("button", { name: "Run query" }).click();

    // Structured result: named counts, numeric values, no chunk cards.
    await expect(page.getByText("matching_documents")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("matching_chunks")).toBeVisible();
    const documentsRow = page.locator("dd").first();
    await expect(documentsRow).toHaveText(/^\d+$/);
  } finally {
    await api.delete(`${handoff.backend_url}/api/collections/${collectionId}/tools/${binding.id}`, {
      headers,
    });
  }
});
