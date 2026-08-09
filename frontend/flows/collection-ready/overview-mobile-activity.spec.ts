/**
 * Flow: overview activity panes on a phone (scenario: collection-ready).
 *
 * 1. Log in via the API and open the overview at 375x812.
 * 2. Expect each pane's title label and its first column label to occupy
 *    separate boxes — at desktop column widths the name cell is squeezed to
 *    zero and the `whitespace-nowrap` title paints over the column beside it.
 * 3. Expect the name column to keep a real width, so document names are
 *    readable rather than truncated to nothing.
 * 4. Expect every column label to sit directly above the value it names, and
 *    the columns to occupy one wrapped line rather than one line each.
 * 5. Expect the page itself never to scroll sideways.
 */
import { expect, test, type Page } from "@playwright/test";

import { loginViaApi } from "../helpers";

test.use({ viewport: { width: 375, height: 812 } });

type Cell = { x: number; y: number; width: number };

/** Left edge, top edge and width of each cell in a pane's header and first row. */
async function paneGeometry(
  page: Page,
  label: string,
): Promise<{ header: Cell[]; row: Cell[] | null }> {
  return page.evaluate((paneLabel) => {
    const pane = document.querySelector(`section[aria-label="${paneLabel}"]`);
    if (!pane) throw new Error(`No pane labelled "${paneLabel}"`);
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width) };
    };
    const cells = (parent: Element) => Array.from(parent.children).map(box);
    const header = pane.firstElementChild?.firstElementChild;
    if (!header) throw new Error(`Pane "${paneLabel}" has no header`);
    const row = pane.querySelector("a");
    return { header: cells(header), row: row ? cells(row) : null };
  }, label);
}

test("overview activity columns wrap under the name instead of colliding on a phone", async ({
  page,
}) => {
  await loginViaApi(page);
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: /aurora-station\.md/ })).toBeVisible();

  for (const pane of ["Recent ingestion", "Recent chats"]) {
    const { header } = await paneGeometry(page, pane);
    const [title, firstColumn] = header;

    // The defect: with no room left, the title's box collapsed to zero width
    // and its text overflowed across the column label beside it, printing
    // "Recent ingestion" on top of "Status".
    expect(title.width).toBeGreaterThan(0);
    const sameLine = title.y === firstColumn.y;
    expect(sameLine && title.x + title.width > firstColumn.x).toBe(false);
  }

  const ingestion = await paneGeometry(page, "Recent ingestion");
  if (!ingestion.row) throw new Error("Recent ingestion pane rendered no rows");

  // A name column with width is what makes the document name readable at all.
  expect(ingestion.row[0].width).toBeGreaterThan(100);

  // Status, Chunks and Added share one wrapped line, each label directly above
  // the value it names — three columns spread over three lines reads as three
  // unrelated facts.
  const labels = ingestion.header.slice(1);
  const values = ingestion.row.slice(1);
  expect(new Set(labels.map((cell) => cell.y)).size).toBe(1);
  expect(values.map((cell) => cell.x)).toEqual(labels.map((cell) => cell.x));

  const scroll = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll.width).toBe(scroll.client);
});

test("the loading skeleton wraps where the rows it stands in for wrap", async ({ page }) => {
  await loginViaApi(page);

  // Hold the overview's data open so the skeleton can be measured: it claims to
  // be the content's final geometry, which on a phone means the same wrapped
  // line the real rows use — a placeholder laid out flat reflows on landing.
  await page.route("**/api/collections**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.continue();
  });

  await page.goto("/dashboard");
  const skeletonRow = page.locator('section[aria-label="Recent ingestion"] div[aria-busy] > div');
  await expect(skeletonRow.first()).toBeVisible();

  const cells = await skeletonRow.first().evaluate((row) =>
    Array.from(row.firstElementChild?.children ?? [], (cell) => {
      const rect = cell.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width) };
    }),
  );

  const [name, ...columns] = cells;
  expect(name.width).toBeGreaterThan(100);
  expect(new Set(columns.map((cell) => cell.y)).size).toBe(1);
  expect(columns[0].y).toBeGreaterThan(name.y);
});
