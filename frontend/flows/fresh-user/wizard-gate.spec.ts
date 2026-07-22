/**
 * Flow: sign-in and setup gating (scenario: fresh-user).
 *
 * 1. Sign in through the form with the seeded credentials (auth is the
 *    subject of this flow, so no API login shortcut).
 * 2. Expect the redirect to /setup: the account exists but has no providers,
 *    index, or collection, so the wizard gates the console.
 */
import { expect, test } from "@playwright/test";

import { gotoSignIn, loadHandoff } from "../helpers";

test("signing in with incomplete setup redirects to the wizard", async ({ page }) => {
  const handoff = loadHandoff();
  await gotoSignIn(page);
  await page.getByLabel("Email").fill(handoff.email!);
  await page.getByLabel("Password").fill(handoff.password!);
  await page.getByRole("button", { name: "Enter dashboard" }).click();

  await page.waitForURL("**/setup", { timeout: 30_000 });
  await expect(page).toHaveURL(/\/setup$/);
});
