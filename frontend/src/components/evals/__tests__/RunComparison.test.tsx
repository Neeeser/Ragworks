import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RunComparison } from "@/components/evals/RunComparison";
import * as apiModule from "@/lib/api";
import { makeEvalRunComparison, makeEvalRunSummary } from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () =>
  (await import("@/test/mocks")).mockAuth({ token: "test-token" }),
);

const routerReplace = vi.fn();
let searchParams = new URLSearchParams("a=run-1&b=run-2");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
  useSearchParams: () => searchParams,
}));

const api = vi.mocked(apiModule);

beforeEach(() => {
  routerReplace.mockClear();
  searchParams = new URLSearchParams("a=run-1&b=run-2");
  api.fetchEvalRuns.mockResolvedValue([
    makeEvalRunSummary({ id: "run-1", name: "Dense baseline" }),
    makeEvalRunSummary({ id: "run-2", name: "Hybrid candidate" }),
  ]);
  api.fetchEvalRunComparison.mockResolvedValue(makeEvalRunComparison());
  api.fetchEvalMetricCatalog.mockResolvedValue([
    { name: "recall", label: "Recall", description: "Share of gold found", is_rank_aware: false },
  ]);
});

describe("RunComparison", () => {
  it("renders both sides, the metric deltas, and the per-query movement", async () => {
    render(<RunComparison />);

    // Once on run A's own facts, once in the configuration-difference table.
    expect(await screen.findAllByText("Dense search")).toHaveLength(2);
    expect(screen.getAllByText("Hybrid search")).toHaveLength(2);
    expect(screen.getByText("+0.20")).toBeInTheDocument();
    expect(screen.getAllByText("0.00").length).toBeGreaterThan(0);
    expect(screen.getByText("1 improved")).toBeInTheDocument();
    expect(screen.getByText("1 regressed")).toBeInTheDocument();
    expect(screen.getByText("capital of France")).toBeInTheDocument();
  });

  it("aligns both runs' retention on one node row", async () => {
    render(<RunComparison />);

    expect(await screen.findByLabelText("Indexed retention, run A")).toBeInTheDocument();
    expect(screen.getByLabelText("Indexed retention, run B")).toBeInTheDocument();
    expect(screen.getByText("+10 pt")).toBeInTheDocument();
  });

  it("states a degraded side invalidates the comparison and still shows the deltas", async () => {
    api.fetchEvalRunComparison.mockResolvedValue(
      makeEvalRunComparison({
        metrics_comparable: false,
        caveats: [
          {
            code: "degraded_run",
            message: "Run B scored 3 queries on a degraded node — a step passed its input through.",
          },
        ],
      }),
    );
    render(<RunComparison />);

    expect(
      await screen.findByText(/Run B scored 3 queries on a degraded node/),
    ).toBeInTheDocument();
    expect(screen.getByText("+0.20")).toBeInTheDocument();
  });

  it("labels a mismatched dataset as an invalid metric comparison without blocking it", async () => {
    api.fetchEvalRunComparison.mockResolvedValue(
      makeEvalRunComparison({
        metrics_comparable: false,
        caveats: [{ code: "different_datasets", message: "These runs scored different datasets." }],
        differences: [
          { label: "Dataset", value_a: "SciFact", value_b: "NFCorpus", invalidates: true },
        ],
      }),
    );
    render(<RunComparison />);

    expect(await screen.findByText("These runs scored different datasets.")).toBeInTheDocument();
    const row = screen.getByRole("rowheader", { name: "Dataset" }).closest("tr");
    expect(within(row!).getByText("NFCorpus")).toBeInTheDocument();
    expect(screen.getByText("+0.20")).toBeInTheDocument();
  });

  it("filters the query table down to the regressions", async () => {
    render(<RunComparison />);
    expect(await screen.findByText("largest ocean")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Regressed" }));

    expect(screen.getByText("capital of France")).toBeInTheDocument();
    expect(screen.queryByText("largest ocean")).not.toBeInTheDocument();
  });

  it("asks for two runs before fetching anything when only one is named", async () => {
    searchParams = new URLSearchParams("a=run-1");
    render(<RunComparison />);

    expect(await screen.findByText(/Pick two runs to compare/)).toBeInTheDocument();
    expect(api.fetchEvalRunComparison).not.toHaveBeenCalled();
  });

  it("writes the pair into the URL so a comparison is linkable", async () => {
    searchParams = new URLSearchParams("a=run-1");
    render(<RunComparison />);

    await userEvent.click(await screen.findByRole("combobox", { name: "Run B" }));
    await userEvent.click(await screen.findByRole("option", { name: "Hybrid candidate" }));

    await waitFor(() =>
      expect(routerReplace).toHaveBeenCalledWith("/evals/compare?a=run-1&b=run-2"),
    );
  });
});
