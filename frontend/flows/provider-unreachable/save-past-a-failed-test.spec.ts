/**
 * Flow: adding a connection whose server is down (scenario: provider-unreachable).
 *
 * 1. Log in via the API and open Settings, then start adding an Ollama
 *    connection pointed at an address nothing answers on.
 * 2. Test reports the refusal in the dialog and leaves the form alone — the
 *    point of the button is to find out, not to gate.
 * 3. Saving surfaces the same refusal and turns the primary action into
 *    "Add anyway", which stores the connection.
 * 4. The stored row says it has never been reached, so nothing claims the
 *    connection is usable before a probe has ever succeeded.
 */
import { expect, test } from "@playwright/test";

import { loginViaApi } from "../helpers";

// A port nothing listens on, so the probe fails on connection refused rather
// than on a slow DNS lookup — a hostname that does not resolve would spend the
// dialog's whole timeout budget waiting.
const DEAD_SERVER = "http://127.0.0.1:9";
const ADD_BUTTON = "Add connection";

test("a connection whose server is down can still be added, and says it is unverified", async ({
  page,
}) => {
  await loginViaApi(page);
  await page.goto("/settings");

  await page.getByRole("button", { name: ADD_BUTTON }).click();
  await page.getByRole("button", { name: /Ollama/ }).click();
  await page.getByLabel("Server URL").fill(DEAD_SERVER);

  await page.getByRole("button", { name: "Test", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("status")).toBeVisible({ timeout: 30_000 });
  // A failed test is information, not a gate: the form is still submittable.
  await expect(dialog.getByRole("button", { name: ADD_BUTTON })).toBeEnabled();

  await dialog.getByRole("button", { name: ADD_BUTTON }).click();
  const confirm = dialog.getByRole("button", { name: "Add anyway" });
  await expect(confirm).toBeVisible({ timeout: 30_000 });
  await confirm.click();

  await expect(page.getByText("Never reached. Validate to make it selectable.")).toBeVisible({
    timeout: 30_000,
  });
});
