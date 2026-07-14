import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ModelSelectorCard } from "@/components/chat-studio/telemetry/ModelSelectorCard";
import { makeCatalogModel } from "@/test/fixtures";

import type { CatalogModel } from "@/lib/types";

describe("ModelSelectorCard", () => {
  it("shows loading and empty states", () => {
    const { rerender } = render(
      <ModelSelectorCard
        currentModelInfo={null}
        selectedModelKey=""
        toolReadyModels={[]}
        filteredModelCatalog={[]}
        modelSearchTerm=""
        onSearchChange={() => undefined}
        sortOption="default"
        onSortChange={() => undefined}
        connectionFilter=""
        onConnectionFilterChange={() => undefined}
        connectionOptions={[]}
        modelsLoading
        modelsError={null}
        toolsEnabled={false}
        onSelectModel={() => undefined}
      />,
    );

    expect(screen.getByText(/Loading tool-compatible models/)).toBeInTheDocument();

    rerender(
      <ModelSelectorCard
        currentModelInfo={null}
        selectedModelKey=""
        toolReadyModels={[]}
        filteredModelCatalog={[]}
        modelSearchTerm="x"
        onSearchChange={() => undefined}
        sortOption="default"
        onSortChange={() => undefined}
        connectionFilter=""
        onConnectionFilterChange={() => undefined}
        connectionOptions={[]}
        modelsLoading={false}
        modelsError={null}
        toolsEnabled={false}
        onSelectModel={() => undefined}
      />,
    );
    expect(screen.getByText(/No models match/)).toBeInTheDocument();

    rerender(
      <ModelSelectorCard
        currentModelInfo={null}
        selectedModelKey=""
        toolReadyModels={[]}
        filteredModelCatalog={[]}
        modelSearchTerm=""
        onSearchChange={() => undefined}
        sortOption="default"
        onSortChange={() => undefined}
        connectionFilter=""
        onConnectionFilterChange={() => undefined}
        connectionOptions={[]}
        modelsLoading={false}
        modelsError="Error"
        toolsEnabled={false}
        onSelectModel={() => undefined}
      />,
    );
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("renders model list and handles interactions", () => {
    const onSearchChange = vi.fn();
    const onSortChange = vi.fn();
    const onSelectModel = vi.fn();
    const onConnectionFilterChange = vi.fn();
    const OLLAMA_CONNECTION = "conn-ollama-1";
    const connectionOptions = [
      { connectionId: "conn-openrouter-1", label: "OpenRouter", providerType: "openrouter" },
      { connectionId: OLLAMA_CONNECTION, label: "Homelab Ollama", providerType: "ollama" },
    ];
    const models: CatalogModel[] = [
      makeCatalogModel({
        id: "model-1",
        name: "Alpha",
        supported_parameters: [],
        context_length: 4096,
        pricing: { prompt: 0.0002, completion: 0.00002 },
      }),
      makeCatalogModel({
        id: "model-2",
        name: "Beta",
        supported_parameters: [],
        context_length: 1024,
        pricing: { prompt: 0.0000015, completion: 0.00000015 },
      }),
      makeCatalogModel({
        id: "model-3",
        name: "Gamma",
        supported_parameters: [],
        context_length: 0,
        pricing: { prompt: "n/a", completion: null },
      }),
      makeCatalogModel({
        id: "model-4",
        name: "Delta",
        supported_parameters: [],
        context_length: 2048,
        pricing: { prompt: 0.0000000005, completion: 0.0000000005 },
      }),
      makeCatalogModel({
        id: "model-5",
        name: "Epsilon",
        supported_parameters: [],
        context_length: 4096,
        pricing: { prompt: 0.0000002, completion: 0.00000002 },
      }),
      makeCatalogModel({
        id: "model-6",
        name: "Zeta",
        supported_parameters: [],
        context_length: 512,
        pricing: { prompt: "   ", completion: "free" },
      }),
      makeCatalogModel({
        id: "model-7",
        name: "Eta",
        supported_parameters: [],
        context_length: 512,
        pricing: { prompt: "1e309", completion: 0.0000000005 },
      }),
      makeCatalogModel({
        id: "model-8",
        name: "Theta",
        supported_parameters: [],
        context_length: 256,
        pricing: { prompt: "0.00005", completion: null },
      }),
    ];

    render(
      <ModelSelectorCard
        currentModelInfo={models[0]}
        selectedModelKey="model-1"
        toolReadyModels={models}
        filteredModelCatalog={models}
        modelSearchTerm=""
        onSearchChange={onSearchChange}
        sortOption="default"
        onSortChange={onSortChange}
        connectionFilter=""
        onConnectionFilterChange={onConnectionFilterChange}
        connectionOptions={connectionOptions}
        modelsLoading={false}
        modelsError={null}
        toolsEnabled
        onSelectModel={onSelectModel}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: "Alpha" } });
    expect(onSearchChange).toHaveBeenCalledWith("Alpha");

    fireEvent.change(screen.getByRole("combobox", { name: "Sort models" }), {
      target: { value: "price" },
    });
    expect(onSortChange).toHaveBeenCalledWith("price");

    const providerFilter = screen.getByRole("combobox", { name: "Filter models by provider" });
    expect(screen.getByRole("option", { name: "All providers" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Homelab Ollama (ollama)" })).toBeInTheDocument();
    fireEvent.change(providerFilter, { target: { value: OLLAMA_CONNECTION } });
    expect(onConnectionFilterChange).toHaveBeenCalledWith(OLLAMA_CONNECTION);

    fireEvent.click(screen.getByRole("button", { name: /Beta/ }));
    expect(onSelectModel).toHaveBeenCalledWith(
      expect.objectContaining({ id: "model-2", connection_id: "conn-openrouter-1" }),
    );

    expect(screen.getByText("$200/M")).toBeInTheDocument();
    expect(screen.getByText("$20.0/M")).toBeInTheDocument();
    expect(screen.getByText("n/a")).toBeInTheDocument();
    expect(screen.getByText("$0.20/M")).toBeInTheDocument();
    expect(screen.getByText("$0.02/M")).toBeInTheDocument();
    expect(screen.getByText("free")).toBeInTheDocument();
    expect(screen.getByText("1e309")).toBeInTheDocument();
    expect(screen.getByText("$50.0/M")).toBeInTheDocument();
  });
});
