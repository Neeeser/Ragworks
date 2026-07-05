import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EmbeddingModelSelectorCard } from "@/components/pipelines/EmbeddingModelSelectorCard";

import type { EmbeddingModelInfo } from "@/lib/types";

describe("EmbeddingModelSelectorCard", () => {
  it("shows loading, empty, and error states", () => {
    const { rerender } = render(
      <EmbeddingModelSelectorCard
        selectedModelKey=""
        models={[]}
        modelsLoading
        modelsError={null}
        onSelectModel={() => undefined}
      />,
    );

    expect(screen.getByText(/Loading embedding models/)).toBeInTheDocument();

    rerender(
      <EmbeddingModelSelectorCard
        selectedModelKey=""
        models={[]}
        modelsLoading={false}
        modelsError={null}
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
        onSelectModel={() => undefined}
      />,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("filters models by the internal search box", () => {
    const models: EmbeddingModelInfo[] = [
      { id: "model-1", name: "Alpha", description: "desc", pricing: { prompt: 0.0002 } },
      { id: "model-2", name: "Beta", description: "desc", pricing: { prompt: 0.0002 } },
    ];

    render(
      <EmbeddingModelSelectorCard
        selectedModelKey=""
        models={models}
        modelsLoading={false}
        modelsError={null}
        onSelectModel={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Beta/ })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: "Alpha" } });

    expect(screen.getByRole("button", { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Beta/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: "nothing" } });
    expect(screen.getByText(/No models match "nothing"/)).toBeInTheDocument();
  });

  it("sorts models via the internal sort control", () => {
    const models: EmbeddingModelInfo[] = [
      { id: "model-big", name: "Big", dimension: 1024, pricing: {} },
      { id: "model-small", name: "Small", dimension: 128, pricing: {} },
    ];

    render(
      <EmbeddingModelSelectorCard
        selectedModelKey=""
        models={models}
        modelsLoading={false}
        modelsError={null}
        onSelectModel={() => undefined}
      />,
    );

    const buttons = () => screen.getAllByRole("button").filter((el) => el.tagName === "BUTTON");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "dimension" } });

    const names = buttons()
      .map((el) => el.textContent ?? "")
      .filter((text) => text.includes("Big") || text.includes("Small"));
    expect(names[0]).toContain("Small");
    expect(names[1]).toContain("Big");
  });

  it("renders models and pricing details, and reports selection", () => {
    const onSelectModel = vi.fn();
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
        selectedModelKey="model-1"
        models={models}
        modelsLoading={false}
        modelsError={null}
        onSelectModel={onSelectModel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Alpha/ }));
    expect(onSelectModel).toHaveBeenCalledWith("model-1");

    expect(screen.getByText(`${longDescription.slice(0, 157)}...`)).toBeInTheDocument();
    expect(screen.getAllByText(/Prompt \$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Completion \$/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Prompt\s+free/)).toBeInTheDocument();
    expect(screen.getByText(/Prompt\s+e/)).toBeInTheDocument();

    // currentModelInfo is now derived internally from models + selectedModelKey.
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);
    expect(screen.getByText("768")).toBeInTheDocument();
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
        selectedModelKey="model-fallback"
        models={models}
        modelsLoading={false}
        modelsError={null}
        onSelectModel={() => undefined}
      />,
    );

    expect(screen.getByText(/Prompt\s+free/)).toBeInTheDocument();
  });
});
