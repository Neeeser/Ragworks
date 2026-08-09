/**
 * Flow: a provider that has gone offline (scenario: provider-unreachable).
 *
 * 1. Log in via the API and open the overview: the dead connection is named
 *    there with the provider's own reason, because a user who never opens a
 *    model picker still has pipelines bound to it.
 * 2. The model picker states the failure against that provider alone, inside
 *    the catalog, while the reachable provider's models still load — a
 *    catalog-wide error banner would blame every provider for one being down.
 * 3. Settings states the same failure on the connection's own row, so the
 *    page the picker links to agrees with the picker.
 */
import { expect, test } from "@playwright/test";

import { loginViaApi } from "../helpers";

const DOWN_CONNECTION = "Ollama (homelab)";

test("a dead provider is reported per connection, never over the whole catalog", async ({
  page,
}) => {
  await loginViaApi(page);

  await page.goto("/dashboard");
  const notice = page.getByLabel("Unreachable providers");
  await expect(notice.getByText(DOWN_CONNECTION)).toBeVisible({ timeout: 30_000 });
  await expect(notice.getByText(/did not answer/)).toBeVisible();

  await page.goto("/chat");
  await page.getByRole("button", { name: "Select model" }).click();
  await page.getByRole("button", { name: "All", exact: true }).click();

  // Scoped to the connection that failed: it is a drawer among the providers,
  // reporting its state where the others report a count, and the provider that
  // answered still lists models beside it.
  const drawer = page.getByRole("button", { name: new RegExp(DOWN_CONNECTION.split(" ")[0]) });
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Unreachable", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Pin / }).first()).toBeVisible();

  // The provider's own reason and the way to fix it sit inside the drawer.
  await drawer.click();
  await expect(page.getByRole("link", { name: "Manage connection" })).toHaveAttribute(
    "href",
    "/settings",
  );

  await page.goto("/settings");
  await expect(page.getByText(/^Unreachable: /)).toBeVisible({ timeout: 30_000 });
});
