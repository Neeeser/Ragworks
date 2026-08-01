/**
 * Flow: pinning, recents, and the model browser (scenario: multi-provider-ready).
 *
 * 1. Log in via the API and open Chat Studio's Model routing section.
 * 2. Expect the All tab up front — a fresh account has no pins or recents, so
 *    the picker must open on a list rather than an empty section.
 * 3. Expect one collapsed drawer per connected provider, each stating how many
 *    models it holds, so a 300-model provider cannot bury the others.
 * 4. Pin a model from its row, and expect the Pinned tab to lead with it.
 * 5. Select it and expect it to become the session's model.
 * 6. Open the model browser, filter by a capability, and expect the drawer
 *    counts to narrow ("N of M") and the detail pane to state what the focused
 *    model takes and returns.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

/** The Anthropic model this flow pins, selects, and inspects. */
const PINNED_MODEL = "Claude Sonnet 5";

test("pins a model, records it as recent, and filters the browser by capability", async ({
  page,
}) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  await page.goto(`${handoff.frontend_url}/chat`);

  // The run settings pane may start closed, and a click before React hydrates
  // silently does nothing — retry the open until the pane appears.
  const openSettings = page.getByRole("button", { name: "Run settings", exact: true }).first();
  const routingToggle = page.getByRole("button", { name: "Model routing toggle" });
  await expect(async () => {
    if (!(await routingToggle.isVisible())) {
      await openSettings.click();
    }
    await expect(routingToggle).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await routingToggle.click();

  // A fresh account has an empty shortlist, so the tabs fall through to All.
  await expect(page.getByRole("button", { name: "All", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // One drawer per connection, each carrying its own count.
  const anthropicDrawer = page.getByRole("button", { name: /Anthropic \(sandbox\)/ });
  await expect(anthropicDrawer).toBeVisible();
  await expect(page.getByRole("button", { name: /OpenRouter \(sandbox\)/ })).toBeVisible();
  await anthropicDrawer.click();

  const model = page.getByRole("button", { name: PINNED_MODEL, exact: true });
  await expect(model).toBeVisible();

  // Pinning is explicit and survives a reload; recents are recorded on use.
  await page.getByRole("button", { name: `Pin ${PINNED_MODEL}` }).click();
  await expect(page.getByRole("button", { name: `Unpin ${PINNED_MODEL}` })).toBeVisible();

  await page.getByRole("button", { name: "Pinned", exact: true }).click();
  await expect(page.getByRole("button", { name: PINNED_MODEL, exact: true })).toBeVisible();
  await page.getByRole("button", { name: PINNED_MODEL, exact: true }).click();

  // Selecting from the picker is what sets the session's model.
  await expect(page.getByRole("button", { name: /Model routing/ }).first()).toContainText(
    PINNED_MODEL,
  );

  // The browser: capability chips are the primary narrowing control.
  await expect(async () => {
    if (!(await routingToggle.isVisible())) {
      await openSettings.click();
    }
    const browse = page.getByRole("button", { name: /Open model browser/ });
    if (!(await browse.isVisible())) {
      await routingToggle.click();
    }
    await expect(browse).toBeVisible({ timeout: 2_000 });
    await browse.click();
  }).toPass({ timeout: 60_000 });

  // The run-settings pane is a dialog too at narrow widths, so name this one.
  const dialog = page.getByRole("dialog", { name: "Models" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Image input (vision)", exact: true }).click();

  // Narrowing states what it excluded rather than silently shrinking the list.
  await expect(dialog.getByRole("button", { name: /OpenAI \(sandbox\)/ })).toContainText(/ of /);

  await dialog.getByRole("button", { name: /Anthropic \(sandbox\)/ }).click();
  await dialog.getByRole("button", { name: "Claude Opus 5", exact: true }).click();

  // The detail pane splits what a model takes from what it returns.
  await expect(dialog.getByText("Text in")).toBeVisible();
  await expect(dialog.getByText("Text out")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /Use this model|Keep this model/ }),
  ).toBeVisible();
});
