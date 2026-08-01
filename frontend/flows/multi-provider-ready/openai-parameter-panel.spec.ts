/**
 * Flow: the OpenAI parameter panel is bundle-backed (scenario: multi-provider).
 *
 * 1. Log in via the API (auth is not the subject) and open Chat Studio.
 * 2. In Model routing, search for gpt-5.4-nano and select the direct OpenAI
 *    connection's entry (the picker shows its real 400K context window).
 * 3. Expect the Model parameters panel to render the Responses floor: the
 *    reasoning-effort select carries the model's published levels (None …
 *    Extra high) and the Additional parameters pass-through is present.
 * 4. Set temperature, max tokens, and an extra_body key; send a message and
 *    expect a live assistant reply plus the bundle's context window in Usage.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

test("gpt-5.4-nano renders bundle-backed parameters and completes a turn", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  await page.goto(`${handoff.frontend_url}/chat`);

  // The run settings pane may start closed, and a click before React
  // hydrates silently does nothing — retry the open until the pane appears.
  const openSettings = page.getByRole("button", { name: "Run settings", exact: true }).first();
  const routingToggle = page.getByRole("button", { name: "Model routing toggle" });
  await expect(async () => {
    if (!(await routingToggle.isVisible())) {
      await openSettings.click();
    }
    await expect(routingToggle).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await routingToggle.click();
  // The picker opens on Pinned or Recent when this account has either, and the
  // catalog search lives on the All tab — ask for it rather than assuming.
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByPlaceholder("Search models across providers…").fill("gpt-5.4-nano");
  // Rows are named by the model's display name. The direct connection titles
  // this model by its bare id; OpenRouter's entry for the same model is named
  // "OpenAI: GPT-5.4 Nano", so an exact name picks the direct one.
  const directEntry = page.getByRole("button", { name: "gpt-5.4-nano", exact: true });
  await expect(directEntry).toContainText("400K");
  await directEntry.click();

  const parametersToggle = page.getByRole("button", { name: "Model parameters toggle" });
  await expect(async () => {
    if (!(await parametersToggle.isVisible())) {
      await openSettings.click();
    }
    await expect(parametersToggle).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await parametersToggle.click();

  const effort = page.getByLabel("Reasoning effort");
  await expect(effort.locator("option")).toContainText([
    "Model default",
    "None",
    "Low",
    "Medium",
    "High",
    "Extra high",
  ]);
  await page.getByLabel("Temperature").fill("0.3");
  await page.getByLabel("Max tokens").fill("600");
  await page.getByLabel("Additional parameters").fill('{ "truncation": "auto" }');

  // The drawer overlays the composer at narrow widths — close it to send.
  const closeSettings = page.getByRole("button", { name: "Close run settings" });
  if (await closeSettings.isVisible().catch(() => false)) {
    await closeSettings.click();
  }
  await page.getByPlaceholder("Send a message…").fill("Reply with exactly: OK");
  await page.getByRole("button", { name: "Send turn" }).click();

  // Live model output: assert shape (a reply arrived), never exact wording.
  await expect(page.getByText("Assistant").first()).toBeVisible({ timeout: 60_000 });

  // The Usage row lives in the run settings pane; its denominator is the
  // bundle's real context window, not the old 8K fallback.
  if (await openSettings.isVisible().catch(() => false)) {
    await openSettings.click();
  }
  await expect(page.getByText(/\/ 400,000 tokens/)).toBeVisible({ timeout: 30_000 });
});
