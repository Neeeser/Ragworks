/**
 * Flow: connecting an agent to a collection over MCP (scenario: mcp-connected).
 *
 * 1. Log in via the API (auth is not the subject) and deep-link to the seeded
 *    collection's overview.
 * 2. Expect the MCP card to show the endpoint an agent must reach — the API's
 *    origin, not the page's, which differ in dev mode.
 * 3. Expect the seeded key to be listed with its capabilities.
 * 4. Create a "Run tools" key through the dialog and expect the one-time
 *    secret plus a ready-to-run client configuration.
 * 5. Call the endpoint with that key and expect a tool list holding exactly
 *    the capability granted — the whole point of scoping.
 * 6. Expect the new key in the account-wide Settings listing, and revoke it.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

const KEY_NAME = "Flow agent";

test("a scoped MCP key created in the UI serves exactly its granted tools", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(seededLink(handoff, "collection"));

  // The endpoint is the API's origin: in dev the frontend and backend are
  // different ports, so showing the page origin would hand over a dead URL.
  const endpoint = page.getByText(/\/api\/mcp\/collections\/[0-9a-f-]+$/).first();
  await expect(endpoint).toBeVisible({ timeout: 30_000 });
  const endpointUrl = ((await endpoint.textContent()) ?? "").trim();
  expect(endpointUrl.startsWith(handoff.backend_url)).toBe(true);

  // The seeded key, with the capabilities the scenario granted it.
  await expect(page.getByText("Sandbox agent").first()).toBeVisible();
  await expect(page.getByText(/RUN TOOLS · READ FILES · WRITE FILES/i).first()).toBeVisible();

  await page.getByRole("button", { name: "Connect an agent" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(KEY_NAME);
  await page.getByRole("button", { name: "Create key" }).click();

  // The secret appears once, beside a configuration a harness can paste.
  const secretBlock = page.getByText(/^rw_[\w-]+$/).first();
  await expect(secretBlock).toBeVisible({ timeout: 30_000 });
  const secret = ((await secretBlock.textContent()) ?? "").trim();
  await expect(page.getByText(/shown once/)).toBeVisible();
  await expect(page.getByText(/claude mcp add ragworks-/)).toBeVisible();
  await page.getByRole("tab", { name: "Cursor" }).click();
  await expect(page.getByText(/"mcpServers"/)).toBeVisible();
  await page.getByRole("tab", { name: "Any client" }).click();
  await expect(page.getByText(/curl -X POST/)).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  // The key reaches the endpoint, and lists only the granted capability's
  // tools — "Run tools" was the sole permission left checked.
  const listing = await page.context().request.post(endpointUrl, {
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
    },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(listing.ok()).toBe(true);
  const body = (await listing.json()) as { result: { tools: { name: string }[] } };
  const names = body.result.tools.map((tool) => tool.name);
  expect(names).toEqual([expect.stringMatching(/^search_/)]);

  // Account-wide management lives in Settings, where the key can be withdrawn.
  await page.goto("/settings");
  const row = page.getByText(KEY_NAME).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: `Revoke ${KEY_NAME}` }).click();
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(page.getByText(`${KEY_NAME} · Revoked`)).toBeVisible({ timeout: 30_000 });
});
