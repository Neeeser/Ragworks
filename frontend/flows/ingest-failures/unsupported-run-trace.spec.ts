/**
 * Flow: an unsupported file's run trace states what happened (scenario:
 * ingest-failures).
 *
 * 1. Log in via the API and open the seeded unsupported run's trace.
 * 2. The header reads "Unsupported file", not Failed — every node ran its
 *    contract; nothing indexed because no parse node read the file.
 * 3. The run-level banner carries the reason (no parse node handles
 *    image/png).
 * 4. The parse node that declined the file reads "Skipped" in its evidence
 *    panel, not a green Done.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

test("an unsupported run names its reason and marks the declining parse node skipped", async ({
  page,
}) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(seededLink(handoff, "unsupported run trace"));

  await expect(page.getByText("Unsupported file")).toBeVisible();
  await expect(page.getByText(/No parse node handles 'image\/png'/)).toBeVisible();

  await page.getByRole("button", { name: "Execution step Extract Text" }).click();
  const evidence = page.getByRole("region", { name: "Node evidence" });
  await expect(evidence.getByText("Skipped")).toBeVisible();
  await expect(evidence.getByText(/no handler for image\/png/)).toBeVisible();
});
