/**
 * Flow: stale-ingestion indicator and collection re-ingest (scenario:
 * collection-ready).
 *
 * 1. Log in via the API (auth is not the subject); save a new version of the
 *    seeded ingestion pipeline through the pipelines API (bump the chunker's
 *    chunk_size — a material change mints a version).
 * 2. On the collection files page, expect every seeded document's status to
 *    read "Out of date" and the re-ingest notice to state the count.
 * 3. Click "Re-ingest out-of-date files" and expect the statuses to return
 *    to "Ready" as the documents re-ingest under the new version.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

test("updating the ingestion pipeline marks files out of date until re-ingested", async ({
  page,
}) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  if (!handoff.email || !handoff.password) {
    throw new Error("Scenario handoff has no seeded login.");
  }
  const auth = await page.context().request.post(`${handoff.backend_url}/api/auth/token`, {
    form: { grant_type: "password", username: handoff.email, password: handoff.password },
  });
  const token = (await auth.json()).access_token as string;
  const headers = { Authorization: `Bearer ${token}` };

  const pipelines = await (
    await page.context().request.get(`${handoff.backend_url}/api/pipelines`, { headers })
  ).json();
  const ingest = pipelines.find((p: { name: string }) => p.name.includes("Ingestion"));
  const detail = await (
    await page
      .context()
      .request.get(`${handoff.backend_url}/api/pipelines/${ingest.id}`, { headers })
  ).json();
  const chunker = detail.definition.nodes.find((n: { type: string }) => n.type.includes("chunk"));
  chunker.config.chunk_size = Number(chunker.config.chunk_size ?? 512) + 16;
  const patch = await page
    .context()
    .request.patch(`${handoff.backend_url}/api/pipelines/${ingest.id}`, {
      headers,
      data: { definition: detail.definition, change_summary: "flow: bump chunk size" },
    });
  expect(patch.ok()).toBe(true);

  await page.goto(seededLink(handoff, "collection files"));
  await expect(page.getByText(/files were ingested with an older version/)).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Out of date").first()).toBeVisible();

  await page.getByRole("button", { name: "Re-ingest out-of-date files" }).click();
  await expect(page.getByText("Out of date")).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText("Ready").first()).toBeVisible({ timeout: 60_000 });
});
