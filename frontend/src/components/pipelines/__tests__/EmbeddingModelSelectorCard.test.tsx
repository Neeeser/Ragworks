import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EmbeddingModelSelectorCard } from "@/components/pipelines/EmbeddingModelSelectorCard";

import type { EmbeddingModelInfo } from "@/lib/types";

describe("EmbeddingModelSelectorCard", () => {
  it("shows loading, empty, and error states", () => {
    const { rerender } = render(
      <EmbeddingModelSelectorCard
        currentModelInfo={null}
        selectedModelKey=""
        filteredModelCatalog={[]}
        modelSearchTerm=""
        onSearchChange={() => undefined}
        modelsLoading
        modelsError={null}
        onSelectModel={() => undefined}
        sortOption="price"
        onSortChange={() => undefined}
      />,
    );

    expect(screen.getByText(/Loading embedding models/)).toBeInTheDocument();

    rerender(
      <EmbeddingModelSelectorCard
        currentModelInfo={null}
        selectedModelKey=""
        filteredModelCatalog={[]}
        modelSearchTerm="hello"
        onSearchChange={() => undefined}
        modelsLoading={false}
        modelsError={null}
        onSelectModel={() => undefined}
        sortOption="price"
        onSortChange={() => undefined}
      />,
    );
    expect(screen.getByText(/No models match/)).toBeInTheDocument();

    rerender(
      <EmbeddingModelSelectorCard
        currentModelInfo={null}
        selectedModelKey=""
        filteredModelCatalog={[]}
        modelSearchTerm=""
        onSearchChange={() => undefined}
        modelsLoading={false}
        modelsError="Failed"
        onSelectModel={() => undefined}
        sortOption="price"
        onSortChange={() => undefined}
      />,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("renders models and pricing details", () => {
    const onSearchChange = vi.fn();
    const onSelectModel = vi.fn();
    const onSortChange = vi.fn();
    const longDescription = "A".repeat(200);
    const models: EmbeddingModelInfo[] = [
      {
        id: "model-1",
        name: "Alpha",
        description: longDescription,
        dimension: 768,
        context_length: 1024,
        pricing: { prompt: 0.0002, completion: 0.00002 },
      },
      {
        id: "model-2",
        name: "Beta",
        description: "desc",
        dimension: 256,
        pricing: { prompt: 0.0000015, completion: 0.00000015 },
      },
      {
        id: "model-3",
        name: "Gamma",
        description: "desc",
        pricing: { prompt: 0.000000015, completion: 0.000000001 },
      },
      {
        id: "model-4",
        name: "Delta",
        description: "desc",
        pricing: { prompt: "free" },
      },
      {
        id: "model-5",
        name: "Epsilon",
        description: "desc",
        pricing: { prompt: "e" },
      },
    ];

    render(
      <EmbeddingModelSelectorCard
        currentModelInfo={models[0]}
        selectedModelKey="model-1"
        filteredModelCatalog={models}
        modelSearchTerm=""
        onSearchChange={onSearchChange}
        modelsLoading={false}
        modelsError={null}
        onSelectModel={onSelectModel}
        sortOption="price"
        onSortChange={onSortChange}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: "Alpha" } });
    expect(onSearchChange).toHaveBeenCalledWith("Alpha");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "dimension" } });
    expect(onSortChange).toHaveBeenCalledWith("dimension");

    fireEvent.click(screen.getByRole("button", { name: /Alpha/ }));
    expect(onSelectModel).toHaveBeenCalledWith("model-1");

    expect(screen.getByText(`${longDescription.slice(0, 157)}...`)).toBeInTheDocument();
    expect(screen.getAllByText(/Prompt \$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Completion \$/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Prompt\s+free/)).toBeInTheDocument();
    expect(screen.getByText(/Prompt\s+e/)).toBeInTheDocument();
  });

  it("renders non-numeric pricing fallbacks", () => {
    const models: EmbeddingModelInfo[] = [
      {
        id: "model-fallback",
        name: "Fallback",
        description: "desc",
        pricing: { prompt: "free", completion: " " },
      },
    ];

    render(
      <EmbeddingModelSelectorCard
        currentModelInfo={models[0]}
        selectedModelKey="model-fallback"
        filteredModelCatalog={models}
        modelSearchTerm=""
        onSearchChange={() => undefined}
        modelsLoading={false}
        modelsError={null}
        onSelectModel={() => undefined}
        sortOption="price"
        onSortChange={() => undefined}
      />,
    );

    expect(screen.getByText(/Prompt\s+free/)).toBeInTheDocument();
  });
});
