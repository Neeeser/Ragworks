/**
 * Flow: the prompt studio over the migrated library (scenario:
 * collection-ready — the startup migration seeds shipped prompts and
 * points every consumer at them).
 *
 * 1. Log in via the API and open the Prompts page.
 * 2. Expect the shipped library seeded by the migration (base prompt,
 *    collection tool prompt, LLM presets) with context chips.
 * 3. Edit the base prompt's template and save it as v2 with a label;
 *    expect the version count and current-version marker to advance.
 * 4. Open the Versions tab and expect the line diff against v1.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

test("shipped prompts are seeded, versionable, and diffable", async ({ page }) => {
  loadHandoff();
  await loginViaApi(page);

  await page.goto("/prompts");
  await expect(page.getByRole("button", { name: /Ragworks base prompt/ })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: /Collection tool prompt/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Contextual Retrieval/ })).toBeVisible();

  await page.getByRole("button", { name: /Ragworks base prompt/ }).click();
  await expect(page.getByRole("heading", { name: "Ragworks base prompt" })).toBeVisible({
    timeout: 20_000,
  });

  const body = page.getByLabel("Template");
  await expect(body).toBeVisible();
  await body.fill("You are Ragworks. Address {{user.full_name}} directly.");
  await page.getByLabel("Version label").fill("flow test");
  await page.getByRole("button", { name: /Save as v/ }).click();

  await expect(page.getByRole("tab", { name: /Versions \(2\)/ })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("tab", { name: /Versions \(2\)/ }).click();
  await expect(page.getByText(/Changes from v1 to v2/)).toBeVisible();
  await expect(page.getByText("flow test")).toBeVisible();
});
