/**
 * Flow: the pipeline editor runs the draft on the canvas (scenario: evals-ready).
 *
 * 1. Log in via the API and open the seeded retrieval pipeline in the editor.
 * 2. Rename a node without saving a version — the header reports it unsaved.
 * 3. Run a sample query from the editor's Run panel.
 * 4. The trace names the *renamed* node, so what ran is the draft on screen
 *    rather than the pipeline's last saved version.
 * 5. The pipeline still has exactly the versions it started with: testing a
 *    change costs no version, which is the whole reason the panel exists.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

const DRAFT_NODE_NAME = "Draft BM25 branch";

test("running from the editor traces the unsaved draft and saves no version", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  // The pipeline id is read at run time, never pinned: a reseed mints a new one.
  const pipelines = await page
    .context()
    .request.get(`${handoff.backend_url}/api/pipelines?kind=retrieval`, {
      headers: { Authorization: `Bearer ${handoff.token}` },
    });
  const [pipeline] = (await pipelines.json()) as Array<{ id: string; current_version: number }>;
  const versionsBefore = await page
    .context()
    .request.get(`${handoff.backend_url}/api/pipelines/${pipeline.id}/versions`, {
      headers: { Authorization: `Bearer ${handoff.token}` },
    });
  const versionCountBefore = ((await versionsBefore.json()) as unknown[]).length;

  await page.goto(`${handoff.frontend_url}/pipelines/retrieval?pipeline=${pipeline.id}`);

  // Edit the draft: rename a node and apply it to the canvas only.
  await page.getByText("BM25 Retriever", { exact: true }).first().click();
  const nodeLabel = page.getByRole("textbox", { name: "Node label" });
  await expect(nodeLabel).toBeVisible();
  await nodeLabel.fill(DRAFT_NODE_NAME);
  await page.getByRole("button", { name: "Save node" }).click();
  await expect(page.getByText(/\d+ unsaved/)).toBeVisible();

  await page.getByRole("button", { name: "Run", exact: true }).click();
  const panel = page.getByRole("dialog");
  await panel.getByRole("textbox", { name: "Sample query" }).fill("What is the Tidepool Protocol?");
  await panel.getByRole("button", { name: "Run", exact: true }).click();

  // The trace is the answer: every node that ran, with the draft's own name on
  // the one that was renamed. Durations are LLM/provider-timed, so the
  // assertion is on shape, never on a value.
  const ledger = panel.getByRole("navigation", { name: "Execution order" });
  await expect(
    ledger.getByRole("button", { name: `Execution step ${DRAFT_NODE_NAME}` }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    ledger.getByRole("button", { name: /Execution step Retrieval Output/ }),
  ).toBeVisible();
  await expect(panel.getByText(/\d+ms/).first()).toBeVisible();

  // Nothing was persisted: no new version, and the saved graph still carries
  // the original node name.
  const versionsAfter = await page
    .context()
    .request.get(`${handoff.backend_url}/api/pipelines/${pipeline.id}/versions`, {
      headers: { Authorization: `Bearer ${handoff.token}` },
    });
  expect(((await versionsAfter.json()) as unknown[]).length).toBe(versionCountBefore);

  const saved = await page
    .context()
    .request.get(`${handoff.backend_url}/api/pipelines/${pipeline.id}`, {
      headers: { Authorization: `Bearer ${handoff.token}` },
    });
  const definition = (await saved.json()) as { definition: { nodes: Array<{ name: string }> } };
  expect(definition.definition.nodes.map((node) => node.name)).not.toContain(DRAFT_NODE_NAME);
});
