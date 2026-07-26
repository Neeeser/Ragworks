/**
 * Flow: choosing indexes when creating a collection and when rebinding a
 * pipeline (scenario: shared-pipelines).
 *
 * 1. Log in via the API and open the collections list.
 * 2. Create a collection, picking a non-default index on the Pipelines step —
 *    the step must offer the choice, and the means to create an index, rather
 *    than silently auto-filling one or sending the user to another page.
 * 3. Confirm every binding the creation made took that index: one set of
 *    choices per collection, so ingestion writes where retrieval reads.
 * 4. Rebind the search pipeline and confirm the index pickers appear while
 *    the change is pending, then that the applied choice persisted.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

interface ToolBinding {
  id: string;
  variable_values?: Record<string, { name: string }>;
}

const COLLECTION_NAME = "Index selection flow";

test("creating a collection asks which index it uses", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  await page.goto(`${handoff.frontend_url}/collections`);

  await page.getByRole("button", { name: "New collection" }).click();
  await page.getByLabel("Collection name").fill(COLLECTION_NAME);
  await page.getByRole("button", { name: "Next" }).click();

  // The Pipelines step offers the collection's index slots — this is the
  // prompt whose absence made every new collection silently inherit one.
  const denseSlot = page.getByLabel(/Vector index this pipeline uses/i);
  await expect(denseSlot).toBeVisible({ timeout: 15_000 });

  // A missing index is made here, not in the registry on another page.
  await expect(page.getByLabel(/New \d+d index on pgvector/)).toBeVisible();

  await denseSlot.click();
  await page.getByRole("option", { name: /^second-index —/ }).click();

  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Create collection" }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20_000 });

  const api = page.context().request;
  const headers = { Authorization: `Bearer ${handoff.token}` };
  const listed = await api.get(`${handoff.backend_url}/api/collections`, { headers });
  const collection = ((await listed.json()) as { id: string; name: string }[]).find(
    (entry) => entry.name === COLLECTION_NAME,
  );
  expect(collection).toBeTruthy();

  const tools = await api.get(`${handoff.backend_url}/api/collections/${collection!.id}/tools`, {
    headers,
  });
  const bindings = ((await tools.json()) as { tools: ToolBinding[] }).tools;
  expect(bindings.length).toBeGreaterThan(0);
  for (const binding of bindings) {
    expect(binding.variable_values?.primary_index?.name).toBe("second-index");
  }

  await api.delete(`${handoff.backend_url}/api/collections/${collection!.id}`, {
    headers,
  });
});

test("rebinding a pipeline asks which index the new binding uses", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  const api = page.context().request;
  const headers = { Authorization: `Bearer ${handoff.token}` };

  // A second retrieval pipeline, so the rebind select has an alternative.
  const existing = await api.get(`${handoff.backend_url}/api/pipelines?kind=retrieval`, {
    headers,
  });
  const [base] = (await existing.json()) as { definition: unknown }[];
  const created = await api.post(`${handoff.backend_url}/api/pipelines`, {
    headers,
    data: { name: "Alternate retrieval (flow)", definition: base.definition },
  });
  expect(created.ok()).toBe(true);
  const alternate = (await created.json()) as { id: string };

  // Its own collection: a spec that rebinds a *seeded* collection depends on
  // whatever the specs before it left behind, which is how order-dependent
  // flakes start.
  const madeCollection = await api.post(`${handoff.backend_url}/api/collections`, {
    headers,
    data: { name: "Rebind flow collection" },
  });
  expect(madeCollection.ok()).toBe(true);
  const target = (await madeCollection.json()) as { id: string };

  try {
    await page.goto(`${handoff.frontend_url}/collections/${target.id}`);

    await page.getByRole("button", { name: "Primary search tool pipeline" }).click();
    await page.getByRole("option", { name: "Alternate retrieval (flow)" }).click();

    // Pending rebind reveals the slots: the new pipeline may target another
    // index, and the user should choose rather than discover it afterwards.
    const denseSlot = page.getByLabel(/Vector index this pipeline uses/i);
    await expect(denseSlot).toBeVisible();

    await denseSlot.click();
    await page.getByRole("option", { name: /^second-index —/ }).click();
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("Pipelines updated.")).toBeVisible({ timeout: 20_000 });

    const tools = await api.get(`${handoff.backend_url}/api/collections/${target.id}/tools`, {
      headers,
    });
    const bindings = ((await tools.json()) as { tools: ToolBinding[] }).tools;
    expect(
      bindings.some((binding) => binding.variable_values?.primary_index?.name === "second-index"),
    ).toBe(true);
  } finally {
    await api.delete(`${handoff.backend_url}/api/collections/${target.id}`, { headers });
    await api.delete(`${handoff.backend_url}/api/pipelines/${alternate.id}`, { headers });
  }
});
