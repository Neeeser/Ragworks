/**
 * Flow: comparing two eval runs (scenario: evals-compared).
 *
 * 1. Log in via the API and open the seeded comparison of two runs over one
 *    dataset that differ only in which search tool scored it.
 * 2. Both sides name their run and their search tool, the configuration
 *    difference names the one field that changed, and the metric table carries
 *    a value per side plus the change between them.
 * 3. Gold retention is drawn per node for both runs on one row, and the
 *    per-query table classifies every query and filters to the regressions.
 * 4. The same page holds together at 375×812 with no horizontal page scroll.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

test("two runs diff side by side, with the one changed field named", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  await page.goto(seededLink(handoff, "eval comparison"));

  await expect(page.getByRole("combobox", { name: "Run A" })).toContainText("Hybrid baseline");
  await expect(page.getByRole("combobox", { name: "Run B" })).toContainText("Dense-only variant");

  // The runs share everything but their search tool, so that is the only row.
  const differences = page.getByRole("table", { name: /Fields the two runs differ on/ });
  await expect(differences.getByRole("rowheader", { name: "Search tool" })).toBeVisible();

  // Scores are real retrieval output — assert the shape, never a value.
  const metrics = page.getByRole("table", { name: /Aggregate metrics on both runs/ });
  await expect(metrics.getByText(/^recall/i).first()).toBeVisible();
  await expect(metrics.getByText(/^[+−]?\d\.\d\d$/).first()).toBeVisible();
});

test("gold retention is drawn for both runs on each node row", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  await page.goto(seededLink(handoff, "eval comparison"));

  const funnel = page.getByRole("heading", { name: "Gold retention by node" });
  await expect(funnel).toBeVisible();
  await expect(page.getByRole("progressbar", { name: /retention, run A/ }).first()).toBeVisible();
  await expect(page.getByRole("progressbar", { name: /retention, run B/ }).first()).toBeVisible();
});

test("the per-query table classifies every query and filters to regressions", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  await page.goto(seededLink(handoff, "eval comparison"));

  await expect(page.getByText(/\d+ improved/)).toBeVisible();
  await expect(page.getByText(/\d+ regressed/)).toBeVisible();
  await expect(page.getByText(/\d+ unchanged/)).toBeVisible();

  await page.getByRole("button", { name: "Regressed" }).click();
  await expect(page.getByRole("button", { name: "Regressed" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("the comparison holds together on a phone", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(seededLink(handoff, "eval comparison"));

  await expect(page.getByRole("heading", { name: "Aggregate metrics" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
