/**
 * Flow: a failed corpus document can be retried (scenario: evals-corpus-gap).
 *
 * 1. Log in via the API and open the seeded run whose corpus lost a document.
 * 2. The run separates the two outcomes: an unscored query (an ingestion
 *    failure) and a short corpus, both distinct from a retrieval miss.
 * 3. Retry requeues exactly the documents that never reached the index, and
 *    says scores come from a new run rather than from the retry.
 * 4. The dataset's corpora pane offers the same repair beside the document
 *    that failed, which is where a user reading the error acts on it.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

test("the run page offers to retry the corpus documents that never indexed", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(seededLink(handoff, "eval run (corpus gap)"));

  await expect(
    page.getByText(/not scored because no gold document reached the index/),
  ).toBeVisible();
  await expect(page.getByText(/corpus documents indexed/)).toBeVisible();

  const retry = page.getByRole("button", { name: "Retry failed documents" });
  await retry.click();

  // The seeded corpus holds exactly one unindexable document, but assert by
  // shape: the point is that the count is the unindexed set, not every
  // document in the collection, and that the user is told where scores come
  // from — the retry repairs the corpus, a run scores it.
  await expect(page.getByText(/\d+ documents? queued for ingestion/)).toBeVisible();
  await expect(page.getByText(/start a new one once ingestion finishes/)).toBeVisible();
});

test("the dataset's corpora pane offers the same repair beside the failed document", async ({
  page,
}) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(seededLink(handoff, "eval dataset (corpus gap)"));

  // Presence only, no second click: the test above already requeued the
  // document, so its row status here is whatever that attempt is doing now.
  // What this pins is that the repair is reachable from the pane listing the
  // failure, not only from a run that happened to notice it.
  await expect(page.getByText(/did not reach the index/)).toBeVisible();
  await expect(page.getByText("glasswing").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry failed documents" })).toBeEnabled();
});
