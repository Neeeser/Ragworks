/**
 * Flow: a structured facet tool renders a per-source table on the search page
 * (scenario: collection-ready).
 *
 * 1. Log in via the API and, through the tools API, bind a facet pipeline
 *    (query input → facet.bm25 grouping by filename → tool.output) to the
 *    seeded collection — pipeline authoring UI is not the subject.
 * 2. Open the collection search page and pick the facet tool in the picker.
 * 3. Run a query and expect a structured facet table: one row per source
 *    file with document and chunk counts, not chunk cards.
 * 4. Unbind the tool so the tools-panel spec sees the seeded state.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

const FACET_DEFINITION = {
  nodes: [
    {
      id: "query-input",
      type: "retrieval.input",
      name: "Input",
      config: {
        tool_name: "facet_by_source",
        tool_description: "Group matching chunks by source file, with counts.",
      },
    },
    {
      id: "facet",
      type: "facet.bm25",
      name: "Facet",
      config: { backend: "pgvector", index_name: "ragworks-bm25", field: "filename" },
    },
    { id: "tool-output", type: "tool.output", name: "Output" },
  ],
  edges: [
    {
      id: "e1",
      source: "query-input",
      target: "facet",
      source_port: "request",
      target_port: "request",
    },
    {
      id: "e2",
      source: "facet",
      target: "tool-output",
      source_port: "values",
      target_port: "values",
    },
  ],
};

test("a bound facet tool renders a per-source table on the search page", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  const collectionUrl = seededLink(handoff, "collection");
  const collectionId = new URL(collectionUrl).pathname.split("/").pop() ?? "";
  const api = page.context().request;
  const headers = { Authorization: `Bearer ${handoff.token}` };

  const pipelineResponse = await api.post(`${handoff.backend_url}/api/pipelines`, {
    headers,
    data: { name: "Facet by source (flow)", definition: FACET_DEFINITION },
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
    await page.getByRole("option", { name: /facet_by_source/ }).click();

    await page.getByRole("textbox", { name: "Search query" }).fill("the");
    await page.getByRole("button", { name: "Run query" }).click();

    // Structured facet result: a table with one row per source file, each
    // carrying numeric document and chunk counts (no chunk cards).
    const table = page.getByRole("table");
    await expect(table).toBeVisible({ timeout: 20_000 });
    await expect(table.getByRole("columnheader", { name: "Documents" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Chunks" })).toBeVisible();
    // At least one bucket row with a numeric chunk count.
    const firstBody = table.locator("tbody tr").first();
    await expect(firstBody.locator("td").nth(2)).toHaveText(/^\d+$/);
  } finally {
    await api.delete(`${handoff.backend_url}/api/collections/${collectionId}/tools/${binding.id}`, {
      headers,
    });
  }
});
