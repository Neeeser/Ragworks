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
 * 6. Switching prompts with an unsaved draft asks before discarding it.
 * 7. On a node prompt, the Values view renders each variable as a chip
 *    carrying its sample value, and typing a sample value updates it.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

const SYSTEM_PROMPT = "System prompt";
const FORK_NAME = "My base prompt";

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

  const editor = page.getByRole("textbox", { name: SYSTEM_PROMPT });
  await expect(editor).toBeVisible();
  await editor.fill("You are Ragworks. Address {{user.full_name}} directly.");
  await page.getByRole("button", { name: "Fork and edit" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(FORK_NAME);
  await dialog.getByRole("button", { name: "Fork", exact: true }).click();

  await expect(page.getByRole("heading", { name: FORK_NAME })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("tab", { name: /Versions \(1\)/ })).toBeVisible();

  // The fork is owned: edit again and save as v2.
  const forkEditor = page.getByRole("textbox", { name: SYSTEM_PROMPT });
  await forkEditor.fill("You are Ragworks. Address {{user.full_name}} directly. Be terse.");
  await page.getByLabel("Version label").fill("flow test");
  await page.getByRole("button", { name: /Save as v2/ }).click();

  await expect(page.getByRole("tab", { name: /Versions \(2\)/ })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("tab", { name: /Versions \(2\)/ }).click();
  await expect(page.getByText(/Changes from v1 to v2/)).toBeVisible();
  await expect(page.getByText("flow test")).toBeVisible();

  // An unsaved draft is never lost to a click in the library — the rail is
  // the natural way to compare two prompts, so it has to ask first.
  await page.getByRole("tab", { name: "Editor" }).click();
  await page
    .getByRole("textbox", { name: SYSTEM_PROMPT })
    .fill("A draft that was never saved as a version.");
  await page.getByRole("button", { name: /Contextual Retrieval/ }).click();
  await expect(page.getByText("Discard unsaved changes?")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: FORK_NAME })).toBeVisible();
});

test("the values view renders variables as chips carrying their sample values", async ({
  page,
}) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(`${handoff.frontend_url}/prompts`);
  await page.getByRole("button", { name: /Query Expansion/ }).click();
  await expect(page.getByRole("heading", { name: "Query Expansion" })).toBeVisible({
    timeout: 20_000,
  });

  // A node prompt's payload variable is what the sample value stands in for.
  const sample = page.getByRole("textbox", { name: "Sample value for text" });
  await sample.fill("carnitine and cardiovascular risk");

  await page.getByRole("button", { name: "Values" }).click();
  const chip = page.locator("[data-template-variable='text']");
  await expect(chip).toHaveText("carnitine and cardiovascular risk");

  // Names view shows the reference itself again, with no chip.
  await page.getByRole("button", { name: "Names" }).click();
  await expect(page.locator("[data-template-variable='text']")).toHaveCount(0);
});
