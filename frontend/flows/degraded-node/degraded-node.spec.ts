/**
 * Flow: a step that never executed says so (scenario: degraded-node).
 *
 * 1. Log in via the API and open the eval run scored through a retrieval
 *    pipeline whose HyDE generator can never succeed.
 * 2. The run completed and carries real metrics — so the run itself, and each
 *    query behind those metrics, has to report that it is degraded.
 * 3. The query's trace names the node: the run header says it completed with
 *    degraded nodes, and the HyDE node carries the provider failure it
 *    absorbed instead of a green Done.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

test("a run whose pipeline degraded is flagged on the run and on every query", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(seededLink(handoff, "eval run (degraded)"));

  // Amber Degraded in the header, beside metrics the run really did produce.
  await expect(page.getByText("Degraded", { exact: true }).first()).toBeVisible();
  // Counts come from the seeded dataset, so assert by shape.
  await expect(page.getByText(/quer(y|ies) ran with a degraded node/)).toBeVisible();
  await expect(
    page.getByText(/passed its input through after its provider failed/).first(),
  ).toBeVisible();
});

test("the trace names the degraded node and the failure it absorbed", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(seededLink(handoff, "eval run (degraded)"));
  await page.getByRole("link", { name: "Open" }).first().click();

  await expect(page.getByText("Completed with degraded nodes")).toBeVisible();

  const ledger = page.getByRole("navigation", { name: "Execution order" });
  await ledger.getByRole("button", { name: "Execution step HyDE" }).click();

  const evidence = page.getByRole("region", { name: "Node evidence" });
  await expect(evidence.getByText("Degraded", { exact: true })).toBeVisible();
  await expect(evidence.getByText(/Passed through: .*LLM call failed/)).toBeVisible();
});
