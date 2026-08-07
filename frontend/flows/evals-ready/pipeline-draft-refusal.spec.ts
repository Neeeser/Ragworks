/**
 * Flow: the Run panel says why a draft was refused (scenario: evals-ready).
 *
 * 1. Log in via the API and open the seeded retrieval pipeline in the editor.
 * 2. Delete the Embedder, leaving the semantic retriever with no inbound items
 *    — a graph the server refuses before any run.
 * 3. Run a sample query from the Run panel.
 * 4. The refusal's own sentence leads, and the graph finding follows it once:
 *    the refusal travels as one shape, so nothing is dropped and nothing is
 *    said twice.
 * 5. No trace pane appears — the run never happened.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

const REFUSAL = "This draft cannot run until its errors are fixed.";

test("a refused draft states its reason once in the Run panel", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  // The pipeline id is read at run time, never pinned: a reseed mints a new one.
  const pipelines = await page
    .context()
    .request.get(`${handoff.backend_url}/api/pipelines?kind=retrieval`, {
      headers: { Authorization: `Bearer ${handoff.token}` },
    });
  const [pipeline] = (await pipelines.json()) as Array<{ id: string }>;

  await page.goto(`${handoff.frontend_url}/pipelines/retrieval?pipeline=${pipeline.id}`);

  // Break the draft on the canvas only: without the embedder, the semantic
  // retriever has no items to read.
  const embedder = page.locator('.react-flow__node[data-id="embed-query"]');
  await expect(embedder).toBeVisible();
  await embedder.click();
  await page.keyboard.press("Delete");
  await expect(embedder).toHaveCount(0);

  await page.getByRole("button", { name: "Run", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Run pipeline" });
  await panel.getByRole("textbox", { name: "Sample query" }).fill("What is the Tidepool Protocol?");
  await panel.getByRole("button", { name: "Run", exact: true }).click();

  await expect(panel.getByText(REFUSAL)).toBeVisible();
  // The node the finding names comes from the server's validation, so it is
  // matched by shape rather than pinned to a message string.
  const finding = panel.getByText(/missing inbound edges/);
  await expect(finding).toHaveCount(1);
  await expect(panel.getByRole("navigation", { name: "Execution order" })).toHaveCount(0);
});
