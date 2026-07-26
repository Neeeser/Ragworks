/**
 * Flow: two collections share one pipeline pair on different indexes
 * (scenario: shared-pipelines).
 *
 * 1. Log in via the API and confirm through the API that both collections
 *    bind the *same* pipeline ids — the state that previously required a
 *    per-collection copy.
 * 2. Confirm each binding resolves to its own index, so the shared definition
 *    is genuinely parameterised rather than merely duplicated.
 * 3. Open the second collection and repoint one tool binding at another index
 *    through the Indexes dialog, checking the re-ingest consequence is stated
 *    before the change is made.
 * 4. Confirm the first collection's binding is untouched — the whole point of
 *    per-binding values.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

interface ToolBinding {
  id: string;
  name: string;
  pipeline_id: string;
  variable_values?: Record<string, { index_id: string; name: string }>;
}

function collectionIdFrom(url: string): string {
  return new URL(url).pathname.split("/").pop() ?? "";
}

test("one pipeline serves two collections against different indexes", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  const api = page.context().request;
  const headers = { Authorization: `Bearer ${handoff.token}` };

  const firstId = collectionIdFrom(seededLink(handoff, "collection"));
  const secondId = collectionIdFrom(seededLink(handoff, "Second Collection overview"));

  const [first, second] = await Promise.all(
    [firstId, secondId].map(async (id) => {
      const response = await api.get(`${handoff.backend_url}/api/collections/${id}/tools`, {
        headers,
      });
      expect(response.ok()).toBe(true);
      return (await response.json()) as { tools: ToolBinding[] };
    }),
  );

  // Same pipeline, both collections — no copy involved.
  const firstPipelines = first.tools.map((tool) => tool.pipeline_id).sort();
  const secondPipelines = second.tools.map((tool) => tool.pipeline_id).sort();
  expect(secondPipelines).toEqual(firstPipelines);

  // ...resolved against different indexes.
  const indexNameOf = (tools: ToolBinding[]) =>
    tools[0]?.variable_values?.primary_index?.name;
  expect(indexNameOf(first.tools)).toBeTruthy();
  expect(indexNameOf(second.tools)).toBeTruthy();
  expect(indexNameOf(second.tools)).not.toBe(indexNameOf(first.tools));
});

test("repointing one collection's index leaves the other alone", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  const api = page.context().request;
  const headers = { Authorization: `Bearer ${handoff.token}` };

  const firstId = collectionIdFrom(seededLink(handoff, "collection"));
  const secondUrl = seededLink(handoff, "Second Collection overview");
  const secondId = collectionIdFrom(secondUrl);

  const before = await api.get(`${handoff.backend_url}/api/collections/${firstId}/tools`, {
    headers,
  });
  const firstIndexBefore = ((await before.json()) as { tools: ToolBinding[] }).tools[0]
    ?.variable_values?.primary_index?.name;

  await page.goto(secondUrl);
  await page.getByRole("button", { name: "Indexes" }).first().click();

  // The consequence is stated before the change, because an index swap moves
  // no data and the resulting empty reads are invisible at query time.
  await expect(page.getByText(/does not move indexed data/i)).toBeVisible();

  await page.getByRole("combobox").first().click();
  await page.getByRole("option").first().click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/does not move indexed data/i)).toBeHidden({ timeout: 15_000 });

  const after = await api.get(`${handoff.backend_url}/api/collections/${firstId}/tools`, {
    headers,
  });
  const firstIndexAfter = ((await after.json()) as { tools: ToolBinding[] }).tools[0]
    ?.variable_values?.primary_index?.name;
  expect(firstIndexAfter).toBe(firstIndexBefore);

  const secondAfter = await api.get(`${handoff.backend_url}/api/collections/${secondId}/tools`, {
    headers,
  });
  expect(secondAfter.ok()).toBe(true);
});

test("the index manager reports which collections use an index", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  const api = page.context().request;

  const response = await api.get(`${handoff.backend_url}/api/indexes`, {
    headers: { Authorization: `Bearer ${handoff.token}` },
  });
  expect(response.ok()).toBe(true);
  const { indexes } = (await response.json()) as {
    indexes: {
      name: string;
      registered: boolean;
      in_use_by: { collection_name: string }[];
    }[];
  };

  // Every index a scaffolded pipeline targets is registered, or nothing could
  // point at it.
  const registered = indexes.filter((index) => index.registered);
  expect(registered.length).toBeGreaterThanOrEqual(2);

  // ...and at least one reports the collections behind it.
  const used = registered.filter((index) => index.in_use_by.length > 0);
  expect(used.length).toBeGreaterThan(0);
});
