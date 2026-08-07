/**
 * Flow: searching a collection with an image (scenario: multimodal-embed).
 *
 * 1. Log in via the API (auth is not the subject) and deep-link to the
 *    seeded collection's search page.
 * 2. The composer refuses to run an empty query, then accepts the same
 *    empty query once an image is attached — an image is a query on its own.
 * 3. Attach galactic-center.jpg through the composer's file input and run it
 *    with no text at all. The document holding that photograph comes back,
 *    which is only possible if the image itself was embedded and matched:
 *    this collection stores no descriptions, and the BM25 branch has no
 *    query text to work with.
 */
import path from "path";

import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

/** The same photograph the collection ingested, asked as a question. */
const QUERY_IMAGE_NAME = "galactic-center.jpg";
const QUERY_IMAGE = path.resolve(__dirname, `../../../sandbox/assets/${QUERY_IMAGE_NAME}`);

test("an image with no text runs a query and returns the page it depicts", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(`${seededLink(handoff, "collection")}/search`);
  const run = page.getByRole("button", { name: "Run query" });
  await expect(run).toBeDisabled();

  // The picker is hidden behind the attach button; setInputFiles drives it
  // without a file chooser dialog.
  await page.locator('form input[type="file"]').setInputFiles(QUERY_IMAGE);
  // The thumbnail is named after the file, so its presence is the composer
  // acknowledging the pick rather than a generic control being visible.
  await expect(page.getByRole("img", { name: QUERY_IMAGE_NAME })).toBeVisible();
  await expect(run).toBeEnabled();

  await run.click();
  await expect(page.getByText(QUERY_IMAGE_NAME).first()).toBeVisible({ timeout: 60_000 });
});

test("the attached image can be removed, leaving nothing to run", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(`${seededLink(handoff, "collection")}/search`);
  await page.locator('form input[type="file"]').setInputFiles(QUERY_IMAGE);
  await page.getByRole("button", { name: `Remove ${QUERY_IMAGE_NAME}` }).click();

  await expect(page.getByRole("img", { name: QUERY_IMAGE_NAME })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run query" })).toBeDisabled();
});
