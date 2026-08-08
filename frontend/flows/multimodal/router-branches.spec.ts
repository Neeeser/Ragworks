/**
 * Flow: routing retrieval results into named branches (scenario: multimodal).
 *
 * The router is the one node whose ports the user defines, so the arc this
 * covers is the whole point of it: configure branches, watch the handles the
 * config produced appear, wire one of them, run, and read the per-branch
 * counts the trace reports.
 *
 * 1. Drag a Router onto the default search tool and give it two
 *    branches — one testing a facet (`item.has_image`), one an item's length.
 * 2. Expect three output handles keyed off the branch ids, derived branches
 *    first and the declared `unmatched` fallback last.
 * 3. Wire Result Limit into it and one branch out to Retrieval Output, then
 *    run a query and read the split.
 * 4. Delete a wired branch and expect its edge to go with its port — an edge
 *    to a handle that no longer resolves is one React Flow stops drawing,
 *    leaving a wire the user cannot see and the next save rejects by name.
 *
 * The multimodal collection is used because it indexes images beside prose,
 * so `item.has_image` genuinely partitions a real result set. Counts are
 * asserted by shape: which chunks rank into the top few is the embedder's
 * property, so pinning exact values would flake on any provider change.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

const QUERY = "station protocol archive";

const ROUTER_NODE = '.react-flow__node:has-text("Router")';
const handleFor = (nodeSelector: string, handleId: string) =>
  `${nodeSelector} .react-flow__handle[data-handleid="${handleId}"]`;

test("a Router splits results into the branches its config defines", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  await page.goto(`${handoff.frontend_url}/pipelines/tools`);

  // Drop a Router onto the canvas from the node library.
  await page.locator("#tab-nodes").click();
  const libraryRouter = page.locator('[draggable="true"]', { hasText: "Router" }).first();
  await expect(libraryRouter).toBeVisible({ timeout: 30_000 });
  await libraryRouter.dragTo(page.locator(".react-flow__pane"));
  await expect(page.locator(ROUTER_NODE)).toBeVisible();

  // Two branches, tried in the order they are listed.
  await page.locator(ROUTER_NODE).dblclick();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("button", { name: "Add branch" }).click();
  await drawer.getByRole("button", { name: "Add branch" }).click();
  // Rows are addressed by position, which holds still while the name is typed.
  await drawer.getByRole("group", { name: "Branch 1" }).getByLabel("Name").fill("Images");
  await drawer.getByLabel("Expression for Images").fill("item.has_image");
  await drawer.getByRole("group", { name: "Branch 2" }).getByLabel("Name").fill("Long text");
  await drawer.getByLabel("Expression for Long text").fill("item.text_length > 200");
  await drawer.getByRole("button", { name: "Save node" }).click();

  // Each branch became an output port, keyed by its id so a rename cannot
  // break a wire; the declared fallback sorts last.
  const handleIds = async () =>
    page
      .locator(`${ROUTER_NODE} .react-flow__handle`)
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-handleid")));
  const configured = await handleIds();
  const branchPorts = configured.filter((id) => id?.startsWith("branch:"));
  expect(branchPorts).toHaveLength(2);
  expect(configured.at(-1)).toBe("unmatched");

  // Wire the router in, and one branch out to the terminal. Dropping onto the
  // terminal's occupied input replaces the wire that was there.
  await page
    .locator(handleFor('.react-flow__node[data-id="limit-results"]', "items"))
    .last()
    .dragTo(page.locator(handleFor(ROUTER_NODE, "items")));
  await page
    .locator(handleFor(ROUTER_NODE, branchPorts[1] as string))
    .dragTo(page.locator(handleFor('.react-flow__node[data-id="retrieval-output"]', "items")));

  await page.getByRole("button", { name: "Run", exact: true }).first().click();
  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await panel.getByPlaceholder("Ask the pipeline something").fill(QUERY);
  await panel.getByRole("button", { name: "Run", exact: true }).click();

  const step = panel.getByRole("button").filter({ hasText: "Router" });
  await expect(step).toBeVisible({ timeout: 60_000 });
  await step.click();
  await panel.getByRole("tab", { name: "Node data" }).click();

  // Every branch is listed with the expression that filled it, in the order
  // the router tried them — including one that took nothing, which is the
  // case a count-sorted or non-empty-only view would hide.
  await expect(panel.getByText("item.has_image")).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText("item.text_length > 200")).toBeVisible();

  // Each branch reports the count it took, beside the test that filled it.
  // Exact values belong to the embedder's ranking, so only the shape is
  // pinned: two branches, both counted, and something actually routed.
  const summary = (await panel.textContent()) ?? "";
  const branchCounts = [...summary.matchAll(/item\.(?:has_image|text_length > 200)\s*(\d+)/g)].map(
    (match) => Number(match[1]),
  );
  expect(branchCounts).toHaveLength(2);
  expect(branchCounts.every((count) => Number.isInteger(count))).toBe(true);
  expect(branchCounts.reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0);

  // Deleting a wired branch takes its port and its edge together.
  await panel.getByRole("button", { name: "Close run panel" }).click();
  const edgeCount = await page.locator(".react-flow__edge").count();
  await page.locator(ROUTER_NODE).dblclick();
  await page.getByRole("dialog").getByRole("button", { name: "Delete Long text" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save node" }).click();

  await expect(page.locator(`${ROUTER_NODE} .react-flow__handle`)).toHaveCount(
    configured.length - 1,
  );
  await expect(page.locator(".react-flow__edge")).toHaveCount(edgeCount - 1);
});
