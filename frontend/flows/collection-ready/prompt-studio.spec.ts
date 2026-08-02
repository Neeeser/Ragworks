/**
 * Flow: the prompt studio over the migrated library (scenario:
 * collection-ready — the startup migration seeds shipped prompts and
 * points every consumer at them).
 *
 * 1. Log in via the API and open the Prompts page.
 * 2. Expect the shipped library seeded by the migration (base prompt,
 *    collection tool prompt, LLM presets) with context chips.
 * 3. Open the base prompt: built-in prompts are read-only, so the editor
 *    offers "Fork and edit" instead of a save control.
 * 4. Edit the system prompt (CodeMirror editor) and fork; the draft
 *    becomes v1 of the new owned prompt.
 * 5. Edit the fork and save it as v2 with a label; expect the version
 *    count to advance and the Versions tab to diff v1 → v2.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

test("built-in prompts are read-only and fork-and-edit versions the draft", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(`${handoff.frontend_url}/prompts`);
  await expect(page.getByRole("button", { name: /Ragworks base prompt/ })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: /Collection tool prompt/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Contextual Retrieval/ })).toBeVisible();

  await page.getByRole("button", { name: /Ragworks base prompt/ }).click();
  await expect(page.getByRole("heading", { name: "Ragworks base prompt" })).toBeVisible({
    timeout: 20_000,
  });

  // Read-only built-in prompt: fork-and-edit replaces the save control.
  await expect(page.getByText("Built-in · read-only")).toBeVisible();
  await expect(page.getByRole("button", { name: /Save as v/ })).toHaveCount(0);

  const editor = page.getByRole("textbox", { name: "System prompt" });
  await expect(editor).toBeVisible();
  await editor.fill("You are Ragworks. Address {{user.full_name}} directly.");
  await page.getByRole("button", { name: "Fork and edit" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("My base prompt");
  await dialog.getByRole("button", { name: "Fork", exact: true }).click();

  await expect(page.getByRole("heading", { name: "My base prompt" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("tab", { name: /Versions \(1\)/ })).toBeVisible();

  // The fork is owned: edit again and save as v2.
  const forkEditor = page.getByRole("textbox", { name: "System prompt" });
  await forkEditor.fill("You are Ragworks. Address {{user.full_name}} directly. Be terse.");
  await page.getByLabel("Version label").fill("flow test");
  await page.getByRole("button", { name: /Save as v2/ }).click();

  await expect(page.getByRole("tab", { name: /Versions \(2\)/ })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("tab", { name: /Versions \(2\)/ }).click();
  await expect(page.getByText(/Changes from v1 to v2/)).toBeVisible();
  await expect(page.getByText("flow test")).toBeVisible();
});
