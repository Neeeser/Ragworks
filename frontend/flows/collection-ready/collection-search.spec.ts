/**
 * Flow: seeded collection and retrieval through the UI (scenario:
 * collection-ready).
 *
 * 1. Log in via the API (auth is not the subject) and deep-link to the
 *    seeded collection's files page.
 * 2. Expect the three seeded sample documents, all ready.
 * 3. On the collection search page, run the aurora query through the real
 *    hybrid retrieval pipeline and expect the aurora document to rank.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

test("seeded documents are ready and retrievable through search", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(seededLink(handoff, "collection files"));
  for (const name of ["aurora-station.md", "tidepool-protocol.md", "glasswing-archive.md"]) {
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 20_000 });
  }

  await page.goto(`${seededLink(handoff, "collection")}/search`);
  await page.getByLabel("Search query").fill("How is power generated aboard Aurora Station?");
  await page.getByRole("button", { name: "Run query" }).click();
  await expect(page.getByText("aurora-station.md").first()).toBeVisible({ timeout: 60_000 });
});
