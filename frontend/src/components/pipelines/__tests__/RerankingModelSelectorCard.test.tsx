import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RerankingModelSelectorCard } from "@/components/pipelines/RerankingModelSelectorCard";
import * as apiModule from "@/lib/api";
import { makeCatalogModel, makeModelShortlist } from "@/test/fixtures";
import { resetMockAuth } from "@/test/mocks";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const api = vi.mocked(apiModule);

const RERANKER = makeCatalogModel({
  connection_id: "cohere-1",
  connection_label: "Production Cohere",
  provider_type: "cohere",
  id: "rerank-current",
  name: "Rerank Current",
  context_length: null,
  max_input_tokens: 4096,
  input_modalities: ["text", "image"],
  output_modalities: ["text"],
});

function renderCard(props: Partial<Parameters<typeof RerankingModelSelectorCard>[0]> = {}) {
  return render(
    <RerankingModelSelectorCard
      models={[RERANKER]}
      selectedModelKey=""
      selectedConnectionId={null}
      selectedAvailability="unknown"
      modelsLoading={false}
      modelsError={null}
      connectionErrors={[]}
      onRetry={vi.fn()}
      onSelectModel={vi.fn()}
      {...props}
    />,
  );
}

describe("RerankingModelSelectorCard", () => {
  beforeEach(() => {
    resetMockAuth();
    api.fetchModelShortlist.mockResolvedValue(makeModelShortlist());
  });

  it("selects a connection-qualified model and shows its input limit", async () => {
    const onSelectModel = vi.fn();
    renderCard({ onSelectModel });
    const user = userEvent.setup();

    // The input limit decides how much retrieved text one call can score.
    expect(await screen.findByText("4,096")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rerank Current" }));

    expect(onSelectModel).toHaveBeenCalledWith(
      expect.objectContaining({ id: "rerank-current", connection_id: "cohere-1" }),
    );
  });

  it("states the modalities the provider published", async () => {
    renderCard();

    // Text is the unbadged baseline; image is a claim the provider made, so
    // the row carries an image mark whose accessible name spells it out.
    expect(await screen.findAllByText("Image input (vision)")).not.toHaveLength(0);
    expect(screen.queryByText("Audio input")).not.toBeInTheDocument();
  });

  it("keeps a saved missing model visible and invalid", async () => {
    renderCard({
      models: [],
      selectedModelKey: "gone-model",
      selectedConnectionId: "cohere-1",
      selectedConnectionLabel: "Production Cohere",
      selectedAvailability: "missing",
    });

    expect(await screen.findByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Production Cohere · gone-model/)).toBeInTheDocument();
  });

  it("distinguishes an empty catalog from an error and supports retry", async () => {
    const onRetry = vi.fn();
    const { rerender } = renderCard({ models: [] });

    expect(await screen.findByText("No reranking models available.")).toBeInTheDocument();

    rerender(
      <RerankingModelSelectorCard
        models={[]}
        selectedModelKey=""
        selectedConnectionId={null}
        selectedAvailability="unknown"
        modelsLoading={false}
        modelsError="Catalog unreachable"
        connectionErrors={[]}
        onRetry={onRetry}
        onSelectModel={vi.fn()}
      />,
    );

    expect(screen.getByText("Catalog unreachable")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onRetry).toHaveBeenCalled());
  });
});
