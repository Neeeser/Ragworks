"use client";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NewRunWizard } from "@/components/evals/NewRunWizard";
import { makeEvalDataset, makePipeline } from "@/test/fixtures";

import type { PipelineVariable } from "@/lib/types";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const RETRIEVAL_PIPELINE = "Search tool";

const resultLimit: PipelineVariable = {
  name: "result_limit",
  type: "integer",
  source: "input",
  description: "Maximum number of results to return.",
  value: 5,
  minimum: 1,
  maximum: 10,
};

function renderWizard() {
  const retrieval = makePipeline({
    id: "pipe-retrieval",
    kind: "retrieval",
    definition: { nodes: [], edges: [], variables: [resultLimit] },
  });
  const ingestion = makePipeline({ id: "pipe-ingestion", name: "Ingestion", kind: "ingestion" });
  render(
    <NewRunWizard
      open
      datasets={[makeEvalDataset({ id: "ds-1", status: "ready" })]}
      pipelines={[ingestion, retrieval]}
      onClose={() => {}}
    />,
  );
}

function goToStep(label: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(label) }));
}

function selectOption(comboboxName: string, optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

describe("NewRunWizard", () => {
  it("labels a bound pipeline input in words and keeps its key beside the label", () => {
    renderWizard();
    goToStep("Pipelines");
    selectOption(RETRIEVAL_PIPELINE, "Retrieval");

    expect(screen.getByText("Result limit")).toBeInTheDocument();
    expect(screen.getByText("result_limit")).toBeInTheDocument();
    expect(screen.getByLabelText("Result limit")).toHaveValue("10");
  });

  it("names the capping input by label and key when cutoffs exceed its depth", () => {
    renderWizard();
    goToStep("Pipelines");
    selectOption(RETRIEVAL_PIPELINE, "Retrieval");
    goToStep("Scope");

    // The variable caps at 10, so @25 is out of reach — and rather than
    // offering it as a selected cutoff that can only ever score zero, the
    // wizard makes it unavailable and names what would lift the cap.
    expect(screen.getByText(/caps results at 10, so @25 is unavailable/)).toBeInTheDocument();
    expect(screen.getByText("result_limit")).toBeInTheDocument();
  });

  it("opens with only the cutoffs the pipeline can actually score", () => {
    // A stock retrieval pipeline returns 10 results while the default
    // selection reaches @25, so an unfiltered wizard starts every run in a
    // configuration that promises a metric it will only ever record as a miss.
    renderWizard();
    goToStep("Pipelines");
    selectOption(RETRIEVAL_PIPELINE, "Retrieval");
    goToStep("Scope");

    const beyondDepth = screen.getByRole("button", { name: "@25" });
    expect(beyondDepth).toBeDisabled();
    expect(beyondDepth).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "@10" })).toHaveAttribute("aria-pressed", "true");
  });

  it("names a capping node by its display name, with no key to show", () => {
    render(
      <NewRunWizard
        open
        datasets={[makeEvalDataset({ id: "ds-1", status: "ready" })]}
        pipelines={[
          makePipeline({ id: "pipe-ingestion", name: "Ingestion", kind: "ingestion" }),
          makePipeline({
            id: "pipe-retrieval",
            kind: "retrieval",
            definition: {
              nodes: [
                {
                  id: "node-1",
                  type: "retriever.pgvector",
                  name: "Semantic retriever",
                  config: { top_k: 5 },
                },
              ],
              edges: [],
            },
          }),
        ]}
        onClose={() => {}}
      />,
    );
    goToStep("Pipelines");
    selectOption(RETRIEVAL_PIPELINE, "Retrieval");
    goToStep("Scope");

    expect(
      screen.getByText(/Semantic retriever caps results at 5, so @10, @25 are unavailable/),
    ).toBeInTheDocument();
  });
});
