import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EmbeddingModelSelectorCard } from "@/components/pipelines/EmbeddingModelSelectorCard";
import * as apiModule from "@/lib/api";
import { makeCatalogModel, makeModelShortlist } from "@/test/fixtures";
import { resetMockAuth } from "@/test/mocks";

import type { CatalogModel } from "@/lib/types";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const api = vi.mocked(apiModule);

const MODELS: CatalogModel[] = [
  makeCatalogModel({ id: "model-1", name: "Alpha", dimension: 1536 }),
  makeCatalogModel({ id: "model-2", name: "Beta", dimension: 768 }),
];

function renderCard(props: Partial<Parameters<typeof EmbeddingModelSelectorCard>[0]> = {}) {
  return render(
    <EmbeddingModelSelectorCard
      selectedModelKey=""
      models={MODELS}
      modelsLoading={false}
      modelsError={null}
      connectionErrors={[]}
      onSelectModel={() => undefined}
      {...props}
    />,
  );
}

describe("EmbeddingModelSelectorCard", () => {
  beforeEach(() => {
    resetMockAuth();
    api.fetchModelShortlist.mockResolvedValue(makeModelShortlist());
  });

  it("shows loading, empty, and error states", async () => {
    const { rerender } = renderCard({ models: [], modelsLoading: true });

    // Loading is a skeleton at the list's final geometry; the only thing said
    // out loud is the placeholder block's accessible name.
    expect(await screen.findByText("Loading models")).toBeInTheDocument();

    rerender(
      <EmbeddingModelSelectorCard
        selectedModelKey=""
        models={[]}
        modelsLoading={false}
        modelsError={null}
        connectionErrors={[]}
        onSelectModel={() => undefined}
      />,
    );
    expect(screen.getByText("No embedding models available.")).toBeInTheDocument();

    rerender(
      <EmbeddingModelSelectorCard
        selectedModelKey=""
        models={[]}
        modelsLoading={false}
        modelsError="Failed"
        connectionErrors={[]}
        onSelectModel={() => undefined}
      />,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("filters models by the search box", async () => {
    renderCard();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Search embedding models/), "Beta");

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Alpha" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Beta" })).toBeInTheDocument();
  });

  it("carries each model's vector dimension on its row", async () => {
    renderCard();

    expect(await screen.findByText("1,536d")).toBeInTheDocument();
    expect(screen.getByText("768d")).toBeInTheDocument();
  });

  it("shows the selected model's dimension beside the controls", async () => {
    renderCard({
      selectedModelKey: "model-2",
      selectedConnectionId: MODELS[1]?.connection_id,
    });

    // Dimension decides whether a model can serve an existing index, so it
    // stays visible without reopening the list.
    expect(await screen.findByText("768")).toBeInTheDocument();
  });

  it("reports the selection", async () => {
    const onSelectModel = vi.fn();
    renderCard({ onSelectModel });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Beta" }));

    expect(onSelectModel).toHaveBeenCalledWith(expect.objectContaining({ id: "model-2" }));
  });

  it("keeps a disappeared selection visible and requires a replacement", async () => {
    renderCard({
      models: [],
      selectedModelKey: "ghost-model",
      selectedConnectionId: "conn-openrouter-1",
      selectedConnectionLabel: "OpenRouter",
      selectedAvailability: "missing",
    });

    expect(await screen.findByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText(/OpenRouter · ghost-model/)).toBeInTheDocument();
    expect(screen.getByText(/no longer available from OpenRouter/)).toBeInTheDocument();
  });
});
