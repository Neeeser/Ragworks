/**
 * Flow: the new-collection wizard binds several tool pipelines
 * (scenario: shared-pipelines — two retrieval pipelines exist, so the tool
 * list has something to add).
 *
 * 1. Open the wizard and confirm a nameless collection can't be walked past:
 *    Next and the later steps in the step list are both disabled.
 * 2. Name it, then on the Pipelines step add the second retrieval pipeline as
 *    a tool and promote it to primary.
 * 3. Confirm the wizard's own dropdown escapes the scrolling step body —
 *    the option is clickable rather than clipped by the footer.
 * 4. Create, and confirm through the API that both tools bound in order with
 *    the promoted one primary.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

const COLLECTION_NAME = "Wizard Flow Collection";

test("creates a collection with two tool pipelines, primary first", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  await page.goto(`${handoff.frontend_url}/collections`);

  await page.getByRole("button", { name: "New collection" }).click();
  const dialog = page.getByRole("dialog");

  // 1. Required name gates Next *and* the step list.
  await expect(dialog.getByRole("button", { name: /Next/ })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: /2\s*Pipelines/ })).toBeDisabled();

  await dialog.getByPlaceholder("Research vault").fill(COLLECTION_NAME);
  await expect(dialog.getByRole("button", { name: /2\s*Pipelines/ })).toBeEnabled();
  await dialog.getByRole("button", { name: /Next/ }).click();

  // 2 + 3. The add-a-tool picker's listbox is portaled, so it is reachable
  // even though it opens past the bottom of the scrolling step body.
  await dialog.getByRole("button", { name: "Retrieval pipeline to add as a tool" }).click();
  await page.getByRole("option").first().click();
  await dialog.getByRole("button", { name: /Add tool/ }).click();
  await dialog.getByRole("button", { name: "Make primary" }).click();

  await dialog.getByRole("button", { name: /Next/ }).click();
  await dialog.getByRole("button", { name: "Create collection" }).click();
  await expect(page.getByText(COLLECTION_NAME)).toBeVisible();

  // 4. The bindings the wizard actually produced.
  const headers = { Authorization: `Bearer ${handoff.token}` };
  const api = page.context().request;
  const href = await page
    .getByRole("link")
    .filter({ hasText: COLLECTION_NAME })
    .first()
    .getAttribute("href");
  const createdId = href?.split("/").pop();
  expect(createdId).toBeTruthy();

  const { tools } = (await (
    await api.get(`${handoff.backend_url}/api/collections/${createdId}/tools`, { headers })
  ).json()) as { tools: { pipeline_name: string; is_primary: boolean; position: number }[] };

  expect(tools).toHaveLength(2);
  expect(tools[0].is_primary).toBe(true);
  expect(tools[1].is_primary).toBe(false);
  expect(tools[0].pipeline_name).not.toBe(tools[1].pipeline_name);
});
