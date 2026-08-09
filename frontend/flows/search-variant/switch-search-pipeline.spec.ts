/**
 * Flow: switching a collection's search pipeline (scenario: search-variant).
 *
 * 1. Log in via the API and deep-link to the seeded collection's overview.
 * 2. Pick the unbound copy in the Pipelines card's "Search tool" control and
 *    apply it. The copy carries the bound default's `search` tool name, so
 *    this only lands if the switch replaces the binding rather than adding
 *    beside it.
 * 3. Expect the Tools panel to re-project the tool from the new pipeline, the
 *    Indexes card to re-read the bound graphs without a reload, and the
 *    binding to survive a reload.
 * 4. Run a query from the Search tab and expect its trace to be the new
 *    pipeline's 5-node graph, not the default's BM25-fused 7.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

const VARIANT = "Dense-Only Retrieval";

test("binding a copy of the default search tool replaces the search tool", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(seededLink(handoff, "collection"));
  const searchTool = page.getByRole("button", { name: "Primary search tool pipeline" });
  await expect(searchTool).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Hybrid Search • returns chunks/)).toBeVisible();

  await searchTool.click();
  await page.getByRole("option", { name: new RegExp(VARIANT) }).click();
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(page.getByText("Pipelines updated.")).toBeVisible({ timeout: 20_000 });
  // The tools panel re-projects from the pipeline that is now bound.
  await expect(page.getByText(new RegExp(`${VARIANT} • returns chunks`))).toBeVisible({
    timeout: 20_000,
  });

  // The Indexes card reports whatever the bound graphs name, so the dense
  // target picks up the copy and the lexical one is left to the ingest
  // pipeline alone — on this page, with no reload.
  const indexes = page.getByRole("list").filter({ hasText: "ragworks-bm25" });
  await expect(indexes.getByText(`Hybrid Ingestion, ${VARIANT}`)).toBeVisible({
    timeout: 20_000,
  });
  await expect(indexes.getByText("Hybrid Ingestion", { exact: true })).toBeVisible();

  await page.reload();
  await expect(searchTool).toContainText(VARIANT, { timeout: 20_000 });

  await page.goto(`${seededLink(handoff, "collection")}/search`);
  await page.getByPlaceholder("Search this collection…").fill("aurora station power");
  await page.getByRole("button", { name: "Run query" }).click();
  // The trace action appears with the result set — the match count is LLM-free
  // but its text repeats inside result snippets, so wait on the control.
  const traceQuery = page.getByRole("button", { name: "Trace query" });
  await expect(traceQuery).toBeVisible({ timeout: 60_000 });

  await traceQuery.click();
  // The execution order is what actually ran: dense only, so the default's
  // lexical branch is absent — the trace names the pipeline that served the
  // query, not the one the collection used to be bound to.
  const steps = page.getByRole("button", { name: /Execution step/ });
  await expect(steps.filter({ hasText: "Semantic Retriever" })).toBeVisible({ timeout: 30_000 });
  await expect(steps.filter({ hasText: "BM25 Retriever" })).toHaveCount(0);
  await expect(steps.filter({ hasText: "RRF Fusion" })).toHaveCount(0);
});
