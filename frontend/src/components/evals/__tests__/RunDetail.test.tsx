import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RunDetail } from "@/components/evals/RunDetail";
import * as apiModule from "@/lib/api";
import { makeEvalRun } from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const api = vi.mocked(apiModule);

describe("RunDetail", () => {
  it("reports how long the run took and what its embedding calls cost", async () => {
    api.fetchEvalRun.mockResolvedValue(
      makeEvalRun({
        usage: {
          ingestion: { total_tokens: 900, cost_usd: 0.002 },
          retrieval: { total_tokens: 60, cost_usd: 0.001 },
        },
      }),
    );
    render(<RunDetail runId="run-1" />);

    expect(await screen.findByText("4m 0s")).toBeInTheDocument();
    expect(screen.getByText("960")).toBeInTheDocument();
    expect(screen.getByText("$0.0030")).toBeInTheDocument();
  });

  it("states tokens with no cost when no provider published a price", async () => {
    api.fetchEvalRun.mockResolvedValue(
      makeEvalRun({ usage: { ingestion: { total_tokens: 900 }, retrieval: {} } }),
    );
    render(<RunDetail runId="run-1" />);

    expect(await screen.findByText("900")).toBeInTheDocument();
    expect(screen.queryByText("Cost")).not.toBeInTheDocument();
  });

  it("omits the usage facts entirely for a run that measured nothing", async () => {
    api.fetchEvalRun.mockResolvedValue(makeEvalRun({ usage: null }));
    render(<RunDetail runId="run-1" />);

    expect(await screen.findByText("Seed")).toBeInTheDocument();
    expect(screen.queryByText("Embedding tokens")).not.toBeInTheDocument();
  });
});
