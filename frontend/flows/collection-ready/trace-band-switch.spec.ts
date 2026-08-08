/**
 * Flow: the trace canvas shows every node the ledger shows, in whichever band
 * is selected (scenario: collection-ready).
 *
 * 1. Log in via the API and invoke the collection's search tool so a query
 *    event with a resolvable origin exists.
 * 2. Open the query trace focused on a retrieved chunk and switch to the
 *    Ingestion band.
 * 3. Expect the band's nodes on the canvas and inside the visible viewport —
 *    the camera refits on the switch instead of keeping the retrieval band's.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

test("switching trace bands renders the band's nodes inside the viewport", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  const auth = await page.context().request.post(`${handoff.backend_url}/api/auth/token`, {
    form: { grant_type: "password", username: handoff.email!, password: handoff.password! },
  });
  const token = (await auth.json()).access_token as string;
  const headers = { Authorization: `Bearer ${token}` };

  const collections = await (
    await page.context().request.get(`${handoff.backend_url}/api/collections`, { headers })
  ).json();
  const collectionId = (Array.isArray(collections) ? collections : collections.items)[0].id;
  const tools = await (
    await page
      .context()
      .request.get(`${handoff.backend_url}/api/collections/${collectionId}/tools`, { headers })
  ).json();
  const search = await (
    await page
      .context()
      .request.post(
        `${handoff.backend_url}/api/collections/${collectionId}/tools/${tools.tools[0].id}/invoke`,
        { headers, data: { query: "aurora station" } },
      )
  ).json();
  expect(search.chunks.length).toBeGreaterThan(0);

  const chunkId = search.chunks[0].chunk_id as string;
  await page.goto(`/traces/queries/${search.query_event_id}?chunk=${encodeURIComponent(chunkId)}`);
  await expect(page.getByRole("tab", { name: "Ingestion" })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("tab", { name: "Ingestion" }).click();
  const canvas = page.locator(".react-flow__viewport").first();
  const nodes = page.locator(".react-flow__node");
  await expect(nodes.first()).toBeVisible();

  const pane = await page.locator(".react-flow").first().boundingBox();
  const count = await nodes.count();
  expect(count).toBeGreaterThan(1);
  for (let index = 0; index < count; index += 1) {
    const box = await nodes.nth(index).boundingBox();
    expect(box, `node ${index} has no box`).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(pane!.x - 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(pane!.x + pane!.width + 1);
    expect(box!.y).toBeGreaterThanOrEqual(pane!.y - 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(pane!.y + pane!.height + 1);
  }
  await expect(canvas).toBeVisible();
});
