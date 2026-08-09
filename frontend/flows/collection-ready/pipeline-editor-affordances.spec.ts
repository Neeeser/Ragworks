/**
 * Flow: editor controls that used to look available and do nothing
 * (scenario: collection-ready).
 *
 * 1. Log in via the API and open the ingestion pipeline editor.
 * 2. Rename the pipeline from its own header; the new name shows immediately.
 * 3. A `?pipeline=&node=` deep link opens that pipeline with the node's editor
 *    drawer, rather than whatever pipeline was last open.
 * 4. Dropping a wire on an already-connected input replaces the existing edge
 *    instead of silently vanishing, and the replacement lands in the unsaved
 *    diff so it is visible and undoable.
 *
 * The seeded name is restored through the API before the drag, so the scenario
 * survives for every other spec sharing this state.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

const SEEDED_NAME = "Hybrid Ingestion";
const RENAMED = "Renamed Ingestion Pipeline";

test("rename, deep link, and occupied-port replacement all do something", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(`${handoff.frontend_url}/pipelines/ingestion`);
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });

  // --- rename ---------------------------------------------------------------
  await page.getByRole("button", { name: `Rename ${SEEDED_NAME}` }).click();
  const renameDialog = page.getByRole("dialog");
  await renameDialog.getByRole("textbox").fill(RENAMED);
  await renameDialog.getByRole("button", { name: /Rename|Save/ }).click();
  await expect(page.getByRole("button", { name: `Rename ${RENAMED}` })).toBeVisible({
    timeout: 20_000,
  });

  // --- deep link ------------------------------------------------------------
  // The id is read from the API rather than the page, so the assertion below
  // cannot pass by being skipped.
  if (!handoff.email || !handoff.password) {
    throw new Error("Scenario handoff has no seeded login.");
  }
  const auth = await page.context().request.post(`${handoff.backend_url}/api/auth/token`, {
    form: { grant_type: "password", username: handoff.email, password: handoff.password },
  });
  const token = (await auth.json()).access_token as string;
  const pipelines = await (
    await page.context().request.get(`${handoff.backend_url}/api/pipelines`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  const ingestion = pipelines.find((entry: { kind: string }) => entry.kind === "ingestion");
  expect(ingestion, "the scenario seeds an ingestion pipeline").toBeTruthy();

  await page.goto(
    `${handoff.frontend_url}/pipelines/ingestion?pipeline=${ingestion.id}&node=index-chunks`,
  );
  const nodeDrawer = page.getByRole("dialog");
  await expect(nodeDrawer).toBeVisible({ timeout: 30_000 });
  await expect(nodeDrawer).toContainText("Indexers");
  await page.getByRole("button", { name: "Close node editor" }).click();

  // --- restore the seeded name ---------------------------------------------
  // Through the API, not the UI: the drag below leaves unsaved canvas state,
  // and a reload to re-read the header would trip the beforeunload guard.
  const restore = await page
    .context()
    .request.patch(`${handoff.backend_url}/api/pipelines/${ingestion.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: SEEDED_NAME },
    });
  expect(restore.ok(), "restoring the seeded pipeline name").toBeTruthy();
  await page.goto(`${handoff.frontend_url}/pipelines/ingestion`);
  await expect(page.getByRole("button", { name: `Rename ${SEEDED_NAME}` })).toBeVisible({
    timeout: 30_000,
  });

  // --- occupied-port replacement -------------------------------------------
  // Left until last: it deliberately leaves the canvas dirty.
  const edgesBefore = await page.locator(".react-flow__edge").count();
  await page
    .locator('[data-id$="-embed-chunks-items-source"]')
    .dragTo(page.locator('[data-id$="-index-bm25-items-target"]'));

  // One edge removed and one added: the count holds, and the diff records both.
  await expect(page.locator(".react-flow__edge")).toHaveCount(edgesBefore);
  await expect(page.getByText(/\d+ unsaved/)).toBeVisible();
});
