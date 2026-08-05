/**
 * Flow: one action clears a whole outage (scenario: ingest-failures).
 *
 * 1. Log in via the API and open the collection's Files page.
 * 2. The notice states how many files are not in the index — the failure the
 *    per-file retry X answers one at a time.
 * 3. Retrying requeues all of them at once: every failed row leaves the failed
 *    state, and the files that were already indexed are not touched.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

test("retrying failed files requeues all of them and spares the indexed ones", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(seededLink(handoff, "collection files"));

  const notice = page.getByText(/files failed to ingest and are not in the index/);
  await expect(notice).toBeVisible();

  const readyBefore = await page.getByText("Ready", { exact: true }).count();
  const failedBefore = await page.getByText("Failed", { exact: true }).count();
  expect(failedBefore).toBeGreaterThan(1); // more than one, or per-file retry would do
  await page.getByRole("button", { name: "Retry failed files" }).click();

  // Requeued rows leave the failed state; the seeded files hold no text, so
  // they land back there — assert on the transition, not the destination.
  await expect(page.getByText("Failed", { exact: true })).toHaveCount(0, { timeout: 15_000 });
  // The already-indexed files were never handed to the queue.
  expect(await page.getByText("Ready", { exact: true }).count()).toBe(readyBefore);
});
