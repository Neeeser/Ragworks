/**
 * Flow: the Overview's Indexes card repoints every binding at once
 * (scenario: shared-pipelines).
 *
 * 1. Create a fresh collection through the API — its bindings auto-fill from
 *    the default pipelines' indexes.
 * 2. The Indexes card lists the dense and BM25 slots with each current index
 *    and the pipelines sharing the slot.
 * 3. Open Change: the dense picker offers only dense indexes, labeled with
 *    backend and width.
 * 4. Quick-create a compatible index from the slot and save.
 * 5. Confirm through the API that the ingest *and* tool bindings both moved —
 *    the fan-out that replaces one dialog per binding.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

interface SlotRead {
  name: string;
  vector_type: string;
  current: { name: string } | null;
}

test("the Indexes card moves every binding to a newly created index", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  const api = page.context().request;
  const headers = { Authorization: `Bearer ${handoff.token}` };

  const suffix = `${Date.now()}`.slice(-8);
  const created = await api.post(`${handoff.backend_url}/api/collections`, {
    headers,
    data: { name: `Card Flow ${suffix}` },
  });
  expect(created.ok()).toBe(true);
  const collectionId = ((await created.json()) as { id: string }).id;

  await page.goto(`${handoff.frontend_url}/collections/${collectionId}`);

  // The card states each slot's current index with backend and width.
  await expect(page.getByRole("heading", { name: "Indexes" })).toBeVisible();
  await expect(page.getByText(/— pgvector · \d+d/).first()).toBeVisible();
  await expect(page.getByText(/— pgvector · sparse/).first()).toBeVisible();

  await page.getByRole("button", { name: "Change" }).click();
  await expect(page.getByText(/applies to every pipeline bound/i)).toBeVisible();

  // The dense picker offers no sparse index.
  await page.getByRole("combobox", { name: /Vector index/ }).click();
  await expect(page.getByRole("option", { name: /sparse/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Create a compatible index from the slot and point the collection at it.
  const indexName = `card-flow-${suffix}`;
  await page.getByLabel(/New \d+d index on pgvector/).fill(indexName);
  await page.getByRole("button", { name: "Create and use" }).nth(1).click();
  await expect(page.getByRole("combobox", { name: /Vector index/ })).toContainText(indexName, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/applies to every pipeline bound/i)).toBeHidden({
    timeout: 15_000,
  });

  // Both bindings — ingest and tool — now resolve to the new index.
  const slots = await api.get(`${handoff.backend_url}/api/collections/${collectionId}/indexes`, {
    headers,
  });
  expect(slots.ok()).toBe(true);
  const dense = ((await slots.json()) as { slots: SlotRead[] }).slots.find(
    (slot) => slot.vector_type === "dense",
  );
  expect(dense?.current?.name).toBe(indexName);

  const tools = await api.get(`${handoff.backend_url}/api/collections/${collectionId}/tools`, {
    headers,
  });
  const toolValues = (
    (await tools.json()) as {
      tools: { variable_values?: Record<string, { name: string }> }[];
    }
  ).tools[0]?.variable_values;
  expect(toolValues?.primary_index?.name).toBe(indexName);
});
