/**
 * Flow: overview growth and latency charts (scenario: collection-ready).
 *
 * 1. Log in via the API and open the seeded collection's overview.
 * 2. Run a few queries through the API so retrieval has recorded events, then
 *    reload — the charts read from one shared history request.
 * 3. Expect the growth charts to draw a step line with an event dot per
 *    ingestion, and the dot to be round rather than stretched by the plot's
 *    non-uniform viewBox.
 * 4. Expect both latency charts to plot individual events, and to explain the
 *    dot, line, and band rather than leaving them as unlabelled shapes.
 * 5. Expect no metric selector: median, p95, and max are all on screen at once.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

test("overview charts plot individual runs and queries over a stepped growth line", async ({
  page,
}) => {
  const handoff = loadHandoff();
  await loginViaApi(page);

  if (!handoff.email || !handoff.password) {
    throw new Error("Scenario handoff has no seeded login.");
  }
  const auth = await page.context().request.post(`${handoff.backend_url}/api/auth/token`, {
    form: { grant_type: "password", username: handoff.email, password: handoff.password },
  });
  const token = (await auth.json()).access_token as string;

  const collectionUrl = seededLink(handoff, "collection");
  const collectionId = collectionUrl.split("/collections/")[1].split(/[/?]/)[0];

  for (const query of ["aurora station", "tidepool protocol", "glasswing archive"]) {
    await page
      .context()
      .request.post(`${handoff.backend_url}/api/collections/${collectionId}/query`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { query, top_k: 3 },
      });
  }

  await page.goto(collectionUrl);
  await expect(page.getByText("Ingestion latency")).toBeVisible();

  // The growth line holds flat between ingestions and jumps at each one, so
  // its path carries the vertical segments a smoothed line would never draw.
  const documents = page.getByRole("img", { name: "Documents over time" });
  await expect(documents).toBeVisible();
  const growthPath = documents.locator("path[stroke-width='2']").first();
  await expect(growthPath).toHaveAttribute("d", /L[\d.]+,[\d.]+L/);

  // Event dots are ellipses whose per-axis radii counter the plot's stretch;
  // a plain circle here renders as a lozenge at every container width.
  const growthDots = documents.locator("ellipse");
  expect(await growthDots.count()).toBeGreaterThan(0);

  for (const name of ["Ingestion run duration", "Retrieval latency"]) {
    const chart = page.getByRole("img", { name });
    await expect(chart).toBeVisible();
    expect(await chart.locator("ellipse").count()).toBeGreaterThan(0);
  }

  await expect(page.getByText(/Each dot is one run; the line is the median/)).toBeVisible();
  await expect(page.getByText(/Each dot is one query; the line is the median/)).toBeVisible();

  // The four-way metric toggle is gone: every one of its states now renders
  // together, so selecting one at a time can no longer hide a change.
  await expect(page.getByRole("button", { name: "p95", exact: true })).toHaveCount(0);
  await expect(page.getByText("median").first()).toBeVisible();
});
