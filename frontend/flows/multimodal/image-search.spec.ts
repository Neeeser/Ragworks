/**
 * Flow: images ingested, described, and retrievable (scenario: multimodal).
 *
 * 1. Log in via the API (auth is not the subject) and deep-link to the
 *    seeded collection's files page.
 * 2. Expect the uploaded image and the figure-bearing PDF to be ready —
 *    both went through the vision branch, so "ready" means a model
 *    described them and the descriptions were indexed.
 * 3. Search for what one image depicts and expect that image's file to
 *    rank, which is only possible if describe → embed → index ran.
 * 4. Open the multimodal pipeline and expect the editor to name the image
 *    modality, so an items edge states what it carries, plus the parse
 *    nodes that produce it and the merge that rejoins the branches.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

test("described images are ingested and retrievable by what they show", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(seededLink(handoff, "collection files"));
  for (const name of ["galactic-center.jpg", "solar-figures.pdf"]) {
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 });
  }

  await page.goto(`${seededLink(handoff, "collection")}/search`);
  await page.getByLabel("Search query").fill("a chart of sunspot numbers per solar cycle");
  await page.getByRole("button", { name: "Run query" }).click();
  // The chart lives inside the PDF; it is findable only through the
  // description the vision model wrote for it.
  await expect(page.getByText("solar-figures.pdf").first()).toBeVisible({ timeout: 60_000 });
  // The match renders the extracted image itself, fetched through the
  // collection asset route — a visible img proves the stored asset
  // reference survived indexing and the route served its bytes.
  await expect(page.getByRole("img", { name: /Image match/ }).first()).toBeVisible({
    timeout: 30_000,
  });
});

test("the editor names the image modality an items edge carries", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(seededLink(handoff, "multimodal pipeline"));
  // The canvas legend names every modality on the graph; the image port's
  // own tooltip carries the same words, hence the exact match.
  await expect(page.getByText("Image items", { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  // The parse nodes fan out from the input in parallel; both image-producing
  // branches are on the canvas, and one merge rejoins them with the text.
  await expect(page.getByText("Extract Media").first()).toBeVisible();
  await expect(page.getByText("Media File").first()).toBeVisible();
  await expect(page.getByText("Merge Items").first()).toBeVisible();
});
