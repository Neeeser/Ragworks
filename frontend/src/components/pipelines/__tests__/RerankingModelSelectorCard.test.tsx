import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RerankingModelSelectorCard } from "@/components/pipelines/RerankingModelSelectorCard";
import { makeCatalogModel } from "@/test/fixtures";

describe("RerankingModelSelectorCard", () => {
  it("selects a connection-qualified model and shows provider metadata", async () => {
    const user = userEvent.setup();
    const onSelectModel = vi.fn();
    const model = makeCatalogModel({
      connection_id: "cohere-1",
      connection_label: "Production Cohere",
      provider_type: "cohere",
      id: "rerank-current",
      name: "Rerank Current",
      context_length: null,
      max_input_tokens: 4096,
      input_modalities: ["text", "image"],
      output_modalities: ["rerank"],
    });

    render(
      <RerankingModelSelectorCard
        models={[model]}
        selectedModelKey=""
        selectedConnectionId={null}
        selectedAvailability="unknown"
        modelsLoading={false}
        modelsError={null}
        onRetry={vi.fn()}
        onSelectModel={onSelectModel}
      />,
    );

    expect(screen.getByText("Production Cohere · Cohere")).toBeInTheDocument();
    expect(screen.getByText("Max input")).toBeInTheDocument();
    expect(screen.getByText("4,096")).toBeInTheDocument();
    expect(screen.getByText("Text")).toBeInTheDocument();
    expect(screen.getByText("Image")).toBeInTheDocument();
    expect(screen.queryByText("Rerank")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Rerank Current/ }));
    expect(onSelectModel).toHaveBeenCalledWith(model);
  });

  it("keeps a saved missing model visible and invalid", () => {
    render(
      <RerankingModelSelectorCard
        models={[
          makeCatalogModel({
            connection_id: "removed-connection",
            connection_label: "Saved connection",
            id: "different-model-id",
          }),
        ]}
        selectedModelKey="same-model-id"
        selectedConnectionId="removed-connection"
        selectedAvailability="missing"
        modelsLoading={false}
        modelsError={null}
        onRetry={vi.fn()}
        onSelectModel={vi.fn()}
      />,
    );

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("Saved connection · same-model-id")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Selected model is no longer available from Saved connection. Select another model.",
      ),
    ).toBeInTheDocument();
  });

  it("states how many models the capped list hides", () => {
    // Regression: the list silently rendered only the first 50 models, so a
    // searched-for model could exist in the catalog but never appear with no
    // hint to narrow the search.
    const models = Array.from({ length: 60 }, (_, index) =>
      makeCatalogModel({ id: `rerank-${index}`, name: `Rerank ${index}` }),
    );

    render(
      <RerankingModelSelectorCard
        models={models}
        selectedModelKey=""
        selectedConnectionId={null}
        selectedAvailability="unknown"
        modelsLoading={false}
        modelsError={null}
        onRetry={vi.fn()}
        onSelectModel={vi.fn()}
      />,
    );

    expect(screen.getByText(/Showing 50 of 60 models/)).toBeInTheDocument();
  });

  it("distinguishes an empty catalog from an error and supports retry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { rerender } = render(
      <RerankingModelSelectorCard
        models={[]}
        selectedModelKey=""
        selectedConnectionId={null}
        selectedAvailability="unknown"
        modelsLoading={false}
        modelsError={null}
        onRetry={onRetry}
        onSelectModel={vi.fn()}
      />,
    );

    expect(screen.getByText("No reranking models available.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();

    rerender(
      <RerankingModelSelectorCard
        models={[]}
        selectedModelKey=""
        selectedConnectionId={null}
        selectedAvailability="unknown"
        modelsLoading={false}
        modelsError="Reranking catalog failed."
        onRetry={onRetry}
        onSelectModel={vi.fn()}
      />,
    );

    expect(screen.getByText("Reranking catalog failed.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
