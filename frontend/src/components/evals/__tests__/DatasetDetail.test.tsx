import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DatasetDetail } from "@/components/evals/DatasetDetail";
import * as apiModule from "@/lib/api";
import { makeEvalDataset } from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const api = vi.mocked(apiModule);

describe("DatasetDetail", () => {
  it("reports fetched documents while a benchmark import downloads its corpus", async () => {
    api.fetchEvalDataset.mockResolvedValue(
      makeEvalDataset({
        name: "ViDoRe economics",
        source: "builtin_benchmark",
        status: "downloading",
        progress_done: 120,
        progress_total: 452,
      }),
    );
    render(<DatasetDetail datasetId="ds-1" />);

    expect(await screen.findByText("120/452")).toBeInTheDocument();
    expect(screen.getByText("documents fetched")).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Downloading ViDoRe economics" }),
    ).toBeInTheDocument();
  });

  it("reports accepted questions while a synthetic dataset generates", async () => {
    api.fetchEvalDataset.mockResolvedValue(
      makeEvalDataset({ name: "Support set", status: "generating", progress_done: 8 }),
    );
    render(<DatasetDetail datasetId="ds-1" />);

    expect(await screen.findByText("8/50")).toBeInTheDocument();
    expect(screen.getByText("questions accepted")).toBeInTheDocument();
  });

  it("shows no progress panel once a dataset is ready", async () => {
    api.fetchEvalDataset.mockResolvedValue(makeEvalDataset({ status: "ready" }));
    render(<DatasetDetail datasetId="ds-1" />);

    expect(await screen.findByText("Ingested corpora")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
