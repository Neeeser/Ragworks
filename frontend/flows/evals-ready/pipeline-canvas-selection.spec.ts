/**
 * Flow: selecting, opening, and deleting a node on the pipeline canvas
 * (scenario: evals-ready).
 *
 * 1. Log in via the API and open the seeded retrieval pipeline's editor.
 * 2. A single click selects a node: its toolbar appears and no inspector opens.
 * 3. The toolbar's Edit opens the inspector on that node.
 * 4. Delete/Backspace removes a selected node together with its edges — the
 *    keyboard path has no visible affordance, so nothing else would catch it
 *    breaking.
 * 5. The toolbar's Delete removes a node the same way.
 * 6. Palette search answers the label the canvas shows ("Semantic Retriever"),
 *    not only the catalog's own ("Retriever").
 * 7. The toolbar is keyboard-operable: Tab from the selected card enters it,
 *    the arrow keys walk its actions, Escape leaves and drops the selection.
 * 8. The canvas legend states the edit and delete keys, which the toolbar's
 *    hover tooltips reach only with a pointer.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

const RETRIEVAL_PIPELINE = /Default Retrieval Pipeline/;
const RETRIEVAL_EDITOR = "/pipelines/retrieval";
const NODES_TAB = "Nodes";
const SEARCH_NODES = "Search nodes";
const SEMANTIC_RETRIEVER = "Semantic Retriever";
const VECTOR_RETRIEVER = "vector-retriever";

/** Node cards carry their definition id, which is stable across reseeds. */
const node = (page: import("@playwright/test").Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"]`);

const edgeCount = (page: import("@playwright/test").Page) =>
  page.locator(".react-flow__edge").count();

test("a click selects a node, Edit opens it, and both delete paths remove it", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(`${handoff.frontend_url}${RETRIEVAL_EDITOR}`);
  await expect(page.getByText(RETRIEVAL_PIPELINE).first()).toBeVisible({ timeout: 30_000 });
  await expect(node(page, VECTOR_RETRIEVER)).toBeVisible();
  const edgesBefore = await edgeCount(page);

  // A single click selects and nothing more — the inspector used to open here.
  await node(page, VECTOR_RETRIEVER).click();
  await expect(page.getByRole("button", { name: "Edit node" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Edit node" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The keyboard path: React Flow binds Backspace on its own, Delete only
  // because the canvas asks for it.
  await node(page, "limit-results").click();
  await page.keyboard.press("Delete");
  await expect(node(page, "limit-results")).toHaveCount(0);

  await node(page, "bm25-retriever").click();
  await page.keyboard.press("Backspace");
  await expect(node(page, "bm25-retriever")).toHaveCount(0);

  // The toolbar path, and the edges leaving with the node it removed.
  await node(page, "fuse-results").click();
  await page.getByRole("button", { name: "Delete node" }).click();
  await expect(node(page, "fuse-results")).toHaveCount(0);
  expect(await edgeCount(page)).toBeLessThan(edgesBefore);
});

test("a double click opens the inspector on the node it lands on", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(`${handoff.frontend_url}${RETRIEVAL_EDITOR}`);
  await expect(node(page, "embed-query")).toBeVisible({ timeout: 30_000 });

  await node(page, "embed-query").dblclick();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Embedders");
});

test("a node dragged from the palette lands where it was dropped, selected", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(`${handoff.frontend_url}${RETRIEVAL_EDITOR}`);
  await expect(node(page, VECTOR_RETRIEVER)).toBeVisible({ timeout: 30_000 });
  const before = await page.locator(".react-flow__node").count();

  await page.getByRole("tab", { name: NODES_TAB }).click();
  await page.getByRole("searchbox", { name: SEARCH_NODES }).fill("Merge Items");
  const row = page.getByRole("button", { name: "Merge Items", exact: true });

  // The palette's own dragstart fills the DataTransfer, so the drop reads the
  // node type the app wrote rather than one the spec invented.
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await row.dispatchEvent("dragstart", { dataTransfer: transfer });

  const pane = page.locator(".react-flow__pane");
  const box = await pane.boundingBox();
  if (!box) throw new Error("The canvas pane has no layout box.");
  const drop = { clientX: Math.round(box.x + box.width * 0.6), clientY: Math.round(box.y + 520) };
  await pane.dispatchEvent("dragover", { dataTransfer: transfer, ...drop });
  await pane.dispatchEvent("drop", { dataTransfer: transfer, ...drop });

  await expect(page.locator(".react-flow__node")).toHaveCount(before + 1);
  const added = page.locator(".react-flow__node.selected");
  await expect(added).toHaveCount(1);
  const addedBox = await added.boundingBox();
  if (!addedBox) throw new Error("The dropped node has no layout box.");
  expect(Math.abs(addedBox.x + addedBox.width / 2 - drop.clientX)).toBeLessThan(24);
  expect(Math.abs(addedBox.y + addedBox.height / 2 - drop.clientY)).toBeLessThan(32);

  // Merge Items has no model or index to choose, so it lands ready to wire up
  // rather than under a drawer covering the graph.
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a dropped node whose index is unset opens its inspector", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(`${handoff.frontend_url}${RETRIEVAL_EDITOR}`);
  await expect(node(page, VECTOR_RETRIEVER)).toBeVisible({ timeout: 30_000 });

  await page.getByRole("tab", { name: NODES_TAB }).click();
  await page.getByRole("searchbox", { name: SEARCH_NODES }).fill(SEMANTIC_RETRIEVER);
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await page
    .getByRole("button", { name: "Retriever", exact: true })
    .dispatchEvent("dragstart", { dataTransfer: transfer });

  const pane = page.locator(".react-flow__pane");
  const box = await pane.boundingBox();
  if (!box) throw new Error("The canvas pane has no layout box.");
  const drop = { clientX: Math.round(box.x + box.width * 0.5), clientY: Math.round(box.y + 520) };
  await pane.dispatchEvent("dragover", { dataTransfer: transfer, ...drop });
  await pane.dispatchEvent("drop", { dataTransfer: transfer, ...drop });

  // A retriever with no index cannot run, so the drawer opens on that choice.
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Retrievers");
});

test("palette search finds a node by the label its instance carries on canvas", async ({
  page,
}) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(`${handoff.frontend_url}${RETRIEVAL_EDITOR}`);
  await expect(node(page, VECTOR_RETRIEVER)).toBeVisible({ timeout: 30_000 });

  await page.getByRole("tab", { name: NODES_TAB }).click();
  await page.getByRole("searchbox", { name: SEARCH_NODES }).fill(SEMANTIC_RETRIEVER);

  // The catalog entry is "Retriever"; the graph names its instance "Semantic
  // Retriever", and searching what you can read must reach it.
  await expect(page.getByText(/No nodes match/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retriever", exact: true })).toBeVisible();
});

test("the node toolbar is reachable and operable from the keyboard", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(`${handoff.frontend_url}${RETRIEVAL_EDITOR}`);
  await expect(node(page, VECTOR_RETRIEVER)).toBeVisible({ timeout: 30_000 });

  await node(page, VECTOR_RETRIEVER).click();
  const toolbar = page.getByRole("toolbar", { name: "Node actions" });
  await expect(toolbar).toBeVisible();

  // The toolbar portals to the end of the canvas, so plain document order
  // leads to every other card before it — the canvas hands focus in instead.
  await node(page, VECTOR_RETRIEVER).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Edit node" })).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "Delete node" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(node(page, VECTOR_RETRIEVER)).toBeFocused();
  await expect(toolbar).toHaveCount(0);
  await expect(node(page, VECTOR_RETRIEVER)).toHaveCount(1);
});

test("the canvas legend states the edit and delete keys", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  await page.goto(`${handoff.frontend_url}${RETRIEVAL_EDITOR}`);
  await expect(node(page, VECTOR_RETRIEVER)).toBeVisible({ timeout: 30_000 });

  await expect(page.getByText("Delete selected node")).toBeVisible();
  await expect(page.getByText("Edit selected node")).toBeVisible();
});
