/**
 * Flow: the retrieval editor names its port types and explains every
 * connection it will not make (scenario: collection-ready).
 *
 * 1. Open the retrieval pipeline; every port reads its canonical type name,
 *    so the one stream the Embedder emits and the Retriever consumes is
 *    called "Embedded items" on both cards rather than "Items" and "Query
 *    Embedding".
 * 2. Dropping a wire the graph cannot carry is refused with a message naming
 *    both streams and the node that bridges them — it used to be refused in
 *    silence, because `isValidConnection` rejecting means xyflow never calls
 *    `onConnect`.
 * 3. Closing a loop reports it immediately and marks every wire in the loop,
 *    instead of surfacing only as an inability to save.
 *
 * Every step leaves the canvas dirty and nothing is saved, so the scenario
 * survives for the specs sharing this state.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

/** `${flowId}-${nodeId}-${portKey}-${source|target}`. */
const handle = (nodeId: string, side: "source" | "target") =>
  `[data-id$="-${nodeId}-items-${side}"]`;

test("port types are named, and refused connections say why", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(`${handoff.frontend_url}/pipelines/retrieval`);
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });

  // --- one stream, one name -------------------------------------------------
  const embedder = page.locator('.react-flow__node[aria-label^="Embedder"]');
  const retriever = page.locator('.react-flow__node[aria-label^="Semantic Retriever"]');
  // The Embedder's output and the Retriever's input are the same stream; the
  // node-local labels for them are "Items" and "Query Embedding".
  await expect(embedder).toContainText("Embedded items");
  await expect(retriever).toContainText("Embedded items");
  // The node-local noun survives only where it adds something — and only above
  // the zoom where a second 11px line is still legible. Zoom all the way in
  // rather than counting steps: the fit-view zoom depends on the viewport, so
  // a fixed number of clicks lands somewhere different on a different screen.
  const zoomIn = page.getByRole("button", { name: /zoom in/i });
  for (let step = 0; step < 8; step += 1) {
    await zoomIn.click();
  }
  await expect(retriever).toContainText("Query Embedding");
  await expect(embedder).not.toContainText("Results");

  // The fan-in port carries both marks, and the legend spells them out.
  await expect(page.locator('.react-flow__node[aria-label^="RRF Fusion"]')).toContainText("∗+");
  // `exact` matters: every port tooltip is in the DOM (hidden) and carries the
  // same words in its own sentence, so a substring match is ambiguous.
  await expect(page.getByText("Required input", { exact: true })).toBeVisible();
  await expect(page.getByText("Accepts many connections", { exact: true })).toBeVisible();

  // Canvas nodes are reachable by name rather than as anonymous groups.
  await expect(embedder).toHaveAttribute("aria-label", "Embedder — Embedders node");

  // Back to the whole graph: the drags below need both ends on screen.
  await page.getByRole("button", { name: /fit view/i }).click();

  // --- a refusal that says what to add --------------------------------------
  // BM25's scored items carry text but no embedding, and the vector retriever
  // requires one on every item.
  const edgesBefore = await page.locator(".react-flow__edge").count();
  await page
    .locator(handle("bm25-retriever", "source"))
    .dragTo(page.locator(handle("vector-retriever", "target")));

  await expect(page.getByRole("status")).toContainText(
    "Scored items → Embedded items: every item needs embedding.",
  );
  await expect(page.getByRole("status")).toContainText("Add an Embedder between them.");
  // Refused means refused: no wire was drawn.
  await expect(page.locator(".react-flow__edge")).toHaveCount(edgesBefore);

  // --- a loop, reported at draw time ----------------------------------------
  await page
    .locator(handle("limit-results", "source"))
    .dragTo(page.locator(handle("fuse-results", "target")));

  await expect(page.getByRole("status")).toContainText(
    "This creates a loop: RRF Fusion → Result Limit → RRF Fusion.",
  );
  // Every wire in the loop is marked, not only the one that closed it — any of
  // them is a valid place to cut.
  await expect(page.getByText(/\d+ unsaved/)).toBeVisible();
  // Asserted on the token rather than a resolved hue, which changes with the
  // user's palette.
  const strokes = await page
    .locator(".react-flow__edge-path")
    .evaluateAll((paths) => paths.map((path) => (path as SVGPathElement).style.stroke));
  expect(strokes.filter((stroke) => stroke.includes("--data-neg"))).toHaveLength(2);
});
