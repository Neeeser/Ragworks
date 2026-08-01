/**
 * Flow: LLM node editors in the pipeline editor (scenario: collection-ready).
 *
 * 1. Log in via the API (auth is not the subject) and open the retrieval
 *    pipeline editor.
 * 2. The node library lists the LLM family with its preset entries.
 * 3. Opening the Contextual Retrieval preset previews the seeded prompt,
 *    the output-field builder, and the structured-output chat model picker.
 * 4. Opening the Semantic Retriever node shows the metadata filter builder;
 *    adding a condition writes a row the drawer renders.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

test("LLM presets and the retriever filter builder render in the editor", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(`${handoff.frontend_url}/pipelines/retrieval`);
  await expect(page.getByText("llm.transform")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Contextual Retrieval" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Select a chat model")).toBeVisible({ timeout: 20_000 });
  await expect(drawer.getByLabel("Prompt", { exact: true })).toHaveValue(/situate this chunk/);
  await expect(drawer.getByLabel("Field 1 name")).toHaveValue("context");
  await drawer.getByRole("button", { name: "Close node editor" }).click();

  // The seeded retrieval graph names its dense retriever "Semantic Retriever".
  await page.locator(".react-flow__node", { hasText: "Semantic Retriever" }).first().click();
  const retrieverDrawer = page.getByRole("dialog");
  await expect(retrieverDrawer.getByText("Metadata filter")).toBeVisible({ timeout: 20_000 });
  await retrieverDrawer.getByRole("button", { name: "Add condition" }).click();
  await expect(retrieverDrawer.getByLabel("Condition 1 field")).toBeVisible();
  await expect(retrieverDrawer.getByLabel("Condition 1 operator")).toBeVisible();
});
