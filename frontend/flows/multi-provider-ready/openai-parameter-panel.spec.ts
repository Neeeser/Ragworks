/**
 * Flow: the OpenAI parameter panel is bundle-backed (scenario: multi-provider).
 *
 * 1. Log in via the API (auth is not the subject) and read the chat catalog,
 *    picking the OpenAI connection's cheapest bundle-backed reasoning model —
 *    no model id is pinned here, because OpenAI retires ids.
 * 2. Open Chat Studio, search that id in Model routing, and expect the direct
 *    connection's row to carry the context window the bundle published.
 * 3. Expect the Model parameters panel to render the Responses floor: the
 *    reasoning-effort select offers exactly the model's published levels, and
 *    the Additional parameters pass-through is present.
 * 4. Set temperature, max tokens, and an extra_body key; send a message and
 *    expect a live assistant reply plus the bundle's context window in Usage.
 */
import { expect, test } from "@playwright/test";

import { formatContextLength } from "@/lib/format";

import { loadHandoff, loginViaApi } from "../helpers";

import type { CatalogModel, ChatCapabilities, ModelCatalogResponse } from "@/lib/types";
import type { Page } from "@playwright/test";

/** A model the shipped bundle knows: it states a context window and what
 * reasoning levels the model takes. */
type BundleBackedModel = CatalogModel & {
  context_length: number;
  capabilities: ChatCapabilities;
};

/** How cheap one live turn on this model is. The flow sends a real message, so
 * the smallest member of a family wins; this only orders candidates, so a
 * retired id changes which model is picked rather than failing the flow. */
function costRank(modelId: string): number {
  if (modelId.includes("nano")) return 0;
  if (modelId.includes("mini")) return 1;
  return 2;
}

function isBundleBacked(model: CatalogModel): model is BundleBackedModel {
  const capabilities = model.capabilities;
  if (model.provider_type !== "openai" || model.deprecated) return false;
  // A context window and published effort levels are exactly what the bundle
  // adds over OpenAI's own listing, which states neither.
  if (!model.context_length || !capabilities) return false;
  if (capabilities.reasoning === "none" || capabilities.reasoning_efforts.length === 0) {
    return false;
  }
  // The sampling knobs must be reachable in the panel's opening state, or the
  // temperature and max-tokens steps have nothing to drive: a model that
  // refuses them while reasoning renders them disabled until reasoning is off.
  return capabilities.sampling === "always" || capabilities.reasoning_efforts.includes("none");
}

/** The OpenAI model this flow drives, chosen from the account's live catalog. */
async function pickBundleBackedModel(page: Page): Promise<BundleBackedModel> {
  const handoff = loadHandoff();
  if (!handoff.token) {
    throw new Error(`Scenario "${handoff.scenario}" seeds no token to read the catalog with.`);
  }
  const response = await page.context().request.get(`${handoff.backend_url}/api/models?kind=chat`, {
    headers: { Authorization: `Bearer ${handoff.token}` },
  });
  if (!response.ok()) {
    throw new Error(`Model catalog failed: ${response.status()} ${await response.text()}`);
  }
  const catalog = (await response.json()) as ModelCatalogResponse;
  const candidates = catalog.models.filter(isBundleBacked);
  if (candidates.length === 0) {
    // Say what the catalog did hold: an empty OpenAI listing is a connection
    // that failed to list, not a provider that retired every reasoning model.
    const listed = catalog.models
      .filter((model) => model.provider_type === "openai")
      .map((model) => model.id)
      .join(", ");
    const errors = catalog.connection_errors
      .map((entry) => `${entry.connection_label}: ${entry.message}`)
      .join("; ");
    throw new Error(
      `No bundle-backed OpenAI reasoning model in the catalog (have: ${listed}) [${errors}]`,
    );
  }
  candidates.sort((a, b) => costRank(a.id) - costRank(b.id) || a.id.localeCompare(b.id));
  return candidates[0];
}

test("a bundle-backed OpenAI model renders its published parameters and completes a turn", async ({
  page,
}) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  const model = await pickBundleBackedModel(page);
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
  await page.getByPlaceholder("Search models across providers…").fill(model.id);
  // Rows are named by the model's display name. The direct connection titles
  // its models by the bare id; OpenRouter's entry for the same model is named
  // "OpenAI: GPT-…", so an exact name picks the direct one.
  const directEntry = page.getByRole("button", { name: model.name, exact: true });
  await expect(directEntry).toContainText(formatContextLength(model.context_length));
  await directEntry.click();

  const parametersToggle = page.getByRole("button", { name: "Model parameters toggle" });
  await expect(async () => {
    if (!(await parametersToggle.isVisible())) {
      await openSettings.click();
    }
    await expect(parametersToggle).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await parametersToggle.click();

  // The effort select is built from what the provider published for this model,
  // led by the empty model-default entry — never a fixed list of levels.
  const effort = page.getByLabel("Reasoning effort");
  await expect(effort).toBeVisible();
  const offered = await effort
    .locator("option")
    .evaluateAll<string[], HTMLOptionElement>((options) => options.map((option) => option.value));
  expect(offered).toEqual(["", ...model.capabilities.reasoning_efforts]);

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
  // bundle's context window for this model, not a fallback.
  if (await openSettings.isVisible().catch(() => false)) {
    await openSettings.click();
  }
  const contextWindow = model.context_length.toLocaleString("en-US");
  await expect(page.getByText(new RegExp(`/ ${contextWindow} tokens`))).toBeVisible({
    timeout: 30_000,
  });
});
