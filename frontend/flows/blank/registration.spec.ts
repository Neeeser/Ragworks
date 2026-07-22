/**
 * Flow: first-account registration (scenario: blank).
 *
 * 1. Open the sign-in page and switch to register mode.
 * 2. Register a new account (the first account becomes admin).
 * 3. Expect to land on /setup — a fresh install has no providers, so the
 *    wizard gates the console.
 */
import { expect, test } from "@playwright/test";

import { gotoSignIn } from "../helpers";

test("registering the first account lands in the setup wizard", async ({ page }) => {
  await gotoSignIn(page);
  await page.getByRole("button", { name: "Need an account?" }).click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();

  await page.getByLabel("Email").fill("first-user@ragworks.dev");
  await page.getByLabel("Full name").fill("First User");
  await page.getByLabel("Password").fill("first-user-password");
  await page.getByRole("button", { name: "Create account" }).click();

  await page.waitForURL("**/setup", { timeout: 30_000 });
});
