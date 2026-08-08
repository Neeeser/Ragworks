/**
 * Flow: expanding retrieval matches to their surrounding context
 * (scenario: context-expansion).
 *
 * 1. Log in via the API and deep-link to the seeded pipeline, which already
 *    carries an Expand Context node in window mode between the retriever and
 *    Result Limit.
 * 2. Run a sample query from the editor's Run panel against the seeded
 *    multi-chunk survey document, and open the Expand Context step's node data.
 * 3. Expect its trace to state the expansion: several matches in, no more items
 *    out than went in, and every item it dropped accounted for as merged —
 *    the counts are what make merging visible rather than inferred.
 *
 * Counts are asserted by shape, not exact value: which chunks the embedder
 * ranks into the top few is a property of the model, so pinning them would
 * flake the moment the provider changes anything.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

const QUERY = "why did the six week survey miss the standing wave";

test("Expand Context widens matches and merges the ones that overlap", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  await page.goto(seededLink(handoff, "context-expansion pipeline"));

  await page.getByRole("button", { name: "Run", exact: true }).first().click();
  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await panel.getByPlaceholder("Ask the pipeline something").fill(QUERY);
  await panel.getByRole("button", { name: "Run", exact: true }).click();

  // The step appears in the execution order once the run completes, which is
  // itself the assertion that the node ran rather than failing the graph.
  const step = panel.getByRole("button").filter({ hasText: "Expand Context" });
  await expect(step).toBeVisible({ timeout: 60_000 });
  await step.click();
  await panel.getByRole("tab", { name: "Node data" }).click();

  const evidence = panel.getByRole("region", { name: "Node evidence" });
  await expect(evidence.getByText("documents read")).toBeVisible({ timeout: 30_000 });

  const expansion = (await evidence.textContent()) ?? "";
  const read = (label: string) => Number(new RegExp(`${label}\\s*(\\d+)`).exec(expansion)?.[1]);
  const matchesIn = read("matches in");
  const expandedOut = read("expanded out");
  const merged = read("merged");
  const documentsRead = read("documents read");

  expect(expansion).toContain("window");
  expect(matchesIn).toBeGreaterThan(1);
  // Expansion never lengthens the stream, and every item it dropped it merged.
  expect(expandedOut).toBeGreaterThan(0);
  expect(expandedOut).toBeLessThanOrEqual(matchesIn);
  expect(merged).toBe(matchesIn - expandedOut);
  // Every match came from the one seeded multi-chunk document, read once.
  expect(documentsRead).toBe(1);
});
