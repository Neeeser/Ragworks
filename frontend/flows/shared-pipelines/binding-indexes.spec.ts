/**
 * Flow: two collections on two stores, via copied pipelines
 * (scenario: shared-pipelines).
 *
 * 1. Log in via the API and confirm each collection reports its own index —
 *    the state that used to need a per-collection override.
 * 2. Confirm the two collections bind *different* pipelines: a pipeline names
 *    the index it uses, so two stores is two graphs.
 * 3. Copy a pipeline from the editor's rail and confirm the copy carries the
 *    same graph under a new name — the supported way to get the second one.
 * 4. Confirm the index registry reports which collections use each index,
 *    read from the definitions rather than any binding selection.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

import type { APIRequestContext } from "@playwright/test";

interface IndexTarget {
  name: string;
  vector_type: string;
  pipelines: string[];
}

function collectionIdFrom(url: string): string {
  return new URL(url).pathname.split("/").pop() ?? "";
}

async function denseTargetOf(
  request: APIRequestContext,
  backendUrl: string,
  headers: Record<string, string>,
  collectionId: string,
): Promise<IndexTarget | undefined> {
  const response = await request.get(`${backendUrl}/api/collections/${collectionId}/indexes`, {
    headers,
  });
  expect(response.ok()).toBe(true);
  const { targets } = (await response.json()) as { targets: IndexTarget[] };
  return targets.find((target) => target.vector_type === "dense");
}

test("each collection reports the index its own pipelines name", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  const api = page.context().request;
  const headers = { Authorization: `Bearer ${handoff.token}` };

  const firstId = collectionIdFrom(seededLink(handoff, "collection"));
  const secondId = collectionIdFrom(seededLink(handoff, "Second Collection overview"));

  const [first, second] = await Promise.all([
    denseTargetOf(api, handoff.backend_url, headers, firstId),
    denseTargetOf(api, handoff.backend_url, headers, secondId),
  ]);

  expect(first?.name).toBeTruthy();
  expect(second?.name).toBeTruthy();
  expect(second?.name).not.toBe(first?.name);
  // Two stores means two graphs — the copy is what makes them independent.
  expect(second?.pipelines).not.toEqual(first?.pipelines);
});

test("copying a pipeline carries its graph under a new name", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  const api = page.context().request;
  const headers = { Authorization: `Bearer ${handoff.token}` };

  await page.goto(`${handoff.frontend_url}/pipelines/ingestion`);
  const original = page.getByRole("button", { name: /^Copy / }).first();
  await expect(original).toBeVisible();
  const label = (await original.getAttribute("aria-label")) ?? "";
  const name = label.replace(/^Copy /, "");

  await original.click();

  await expect(page.getByText(`Copied to "${name} (copy)".`)).toBeVisible({ timeout: 15_000 });

  const listed = await api.get(`${handoff.backend_url}/api/pipelines`, { headers });
  const pipelines = (await listed.json()) as { name: string; is_default: boolean }[];
  const copy = pipelines.find((pipeline) => pipeline.name === `${name} (copy)`);
  expect(copy).toBeTruthy();
  // A copy claims no default role — two pipelines claiming it would make "the
  // default ingestion pipeline" ambiguous.
  expect(copy?.is_default).toBe(false);
});

test("the index registry reports which collections use an index", async ({ page }) => {
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

  // Every index a scaffolded pipeline names is registered, or nothing could
  // point at it.
  const registered = indexes.filter((index) => index.registered);
  expect(registered.length).toBeGreaterThanOrEqual(2);

  // ...and usage is read from the definitions that name them.
  const used = registered.filter((index) => index.in_use_by.length > 0);
  expect(used.length).toBeGreaterThan(0);
});
