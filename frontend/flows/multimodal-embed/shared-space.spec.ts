/**
 * Flow: images found through the shared vector space (scenario:
 * multimodal-embed).
 *
 * 1. Log in via the API (auth is not the subject) and deep-link to the
 *    seeded collection's search page.
 * 2. Search for what an image depicts and expect the file holding it to
 *    rank. The corpus carries no descriptions — the pipeline has no
 *    describe node — so a match can only come from the image's own vector.
 * 3. Open the pipeline and confirm no vision node stands between the image
 *    source and its embedder, which is what makes step 2 meaningful.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

test("an image is retrieved by what it depicts, with no description in the corpus", async ({
  page,
}) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(`${seededLink(handoff, "collection")}/search`);
  await page.getByLabel("Search query").fill("a chart of sunspot numbers per solar cycle");
  await page.getByRole("button", { name: "Run query" }).click();
  await expect(page.getByText("solar-figures.pdf").first()).toBeVisible({ timeout: 60_000 });
});

test("the pipeline embeds images directly, with no vision node in between", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(seededLink(handoff, "multimodal pipeline"));
  await expect(page.getByText("Image Source").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("PDF Images").first()).toBeVisible();
  await expect(page.getByText("Vision Transform")).toHaveCount(0);
});
