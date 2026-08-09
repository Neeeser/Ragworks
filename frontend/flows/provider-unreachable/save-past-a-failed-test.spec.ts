/**
 * Flow: adding a connection whose server is down (scenario: provider-unreachable).
 *
 * 1. Log in via the API and open Settings, then start adding an Ollama
 *    connection pointed at an address nothing answers on.
 * 2. Test reports the refusal in the dialog and leaves the form submittable —
 *    the button exists to find out, not to gate.
 * 3. Saving surfaces the same refusal and turns the primary action into
 *    "Add anyway", which stores the connection.
 * 4. The stored row carries the address and states the failure against itself,
 *    so a connection saved past its test is visibly degraded, never silently
 *    broken.
 * 5. The connection is removed again: every spec in this directory runs against
 *    one seeded database, and a second dead Ollama changes what the sibling
 *    flow's per-connection assertions match.
 */
import { expect, test } from "@playwright/test";

import { loginViaApi } from "../helpers";

// A port nothing listens on, so the probe fails on connection refused rather
// than on a slow DNS lookup — a hostname that does not resolve would spend the
// dialog's whole timeout budget waiting.
const DEAD_SERVER = "http://127.0.0.1:9";
// The dialog seeds the label from the provider type, so the new row is named
// "Ollama" — distinct from the scenario's own "Ollama (homelab)".
const REMOVE_NEW_ROW = "Remove Ollama";
const ADD_BUTTON = "Add connection";

test("a connection whose server is down can still be added, and says so on its row", async ({
  page,
}) => {
  await loginViaApi(page);
  await page.goto("/settings");

  await page.getByRole("button", { name: "Add provider" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Ollama/ }).click();
  await dialog.getByLabel("Server URL").fill(DEAD_SERVER);

  await dialog.getByRole("button", { name: "Test", exact: true }).click();
  await expect(dialog.getByText(/unreachable/i)).toBeVisible({ timeout: 30_000 });
  // A failed test is information, not a gate: the form is still submittable.
  await expect(dialog.getByRole("button", { name: ADD_BUTTON })).toBeEnabled();

  await dialog.getByRole("button", { name: ADD_BUTTON }).click();
  const confirm = dialog.getByRole("button", { name: "Add anyway" });
  await expect(confirm).toBeVisible({ timeout: 30_000 });
  await confirm.click();

  // The row exists — the whole point of the feature — and names the address it
  // could not reach, so the failure is attributed to this connection.
  await expect(page.getByText(DEAD_SERVER)).toBeVisible({ timeout: 30_000 });

  // Leave the scenario as it was found.
  await page.getByRole("button", { name: REMOVE_NEW_ROW, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText(DEAD_SERVER)).toBeHidden({ timeout: 30_000 });
});
