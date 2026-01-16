import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IndexManagerModal } from "@/components/pipelines/index-manager/IndexManagerModal";

import type { EmbeddingModelInfo, PineconeIndex } from "@/lib/types";

const api = {
  createPineconeIndex: vi.fn(),
  deletePineconeIndex: vi.fn(),
};

let lastEmbeddingProps: Record<string, unknown> | null = null;
const deleteIndexLabel = "Delete index";

vi.mock("@/lib/api", () => ({
  createPineconeIndex: (...args: unknown[]) => api.createPineconeIndex(...args),
  deletePineconeIndex: (...args: unknown[]) => api.deletePineconeIndex(...args),
}));

vi.mock("@/components/pipelines/EmbeddingModelSelectorCard", () => ({
  EmbeddingModelSelectorCard: (props: Record<string, unknown>) => {
    lastEmbeddingProps = props;
    return (
      <button type="button" onClick={() => (props.onSelectModel as (id: string) => void)("emb-1")}>
        Select embedding
      </button>
    );
  },
}));

describe("IndexManagerModal", () => {
  const indexes: PineconeIndex[] = [
    {
      name: "alpha",
      dimension: 768,
      metric: "cosine",
      host: "host",
      spec: null,
      status: { state: "READY" },
      vector_type: "dense",
    },
  ];

  const embeddingModels: EmbeddingModelInfo[] = [
    { id: "emb-1", name: "Embed", dimension: 1536 },
    { id: "emb-2", name: "Other", dimension: 1024 },
  ];

  beforeEach(() => {
    api.createPineconeIndex.mockReset();
    api.deletePineconeIndex.mockReset();
    lastEmbeddingProps = null;
  });

  it("returns null when closed", () => {
    const { container } = render(
      <IndexManagerModal
        open={false}
        token="token"
        indexes={[]}
        embeddingModels={[]}
        onClose={() => undefined}
        onRefresh={() => undefined}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows loading state while indexes are fetching", () => {
    render(
      <IndexManagerModal
        open
        token="token"
        indexes={[]}
        embeddingModels={embeddingModels}
        loading
        onClose={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    expect(screen.getByText("Loading indexes...")).toBeInTheDocument();
  });

  it("shows details and handles deletion flow", async () => {
    const onRefresh = vi.fn();
    render(
      <IndexManagerModal
        open
        token="token"
        indexes={indexes}
        embeddingModels={embeddingModels}
        onClose={() => undefined}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByText("Index details")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: deleteIndexLabel }));

    expect(screen.getByText(/Confirm index deletion/)).toBeInTheDocument();
    const overlays = screen.getAllByRole("presentation");
    fireEvent.click(overlays[overlays.length - 1]);
    await waitFor(() => {
      expect(screen.queryByText(/Confirm index deletion/)).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: deleteIndexLabel }));
    expect(screen.getByText(/Confirm index deletion/)).toBeInTheDocument();
    const confirmInput = screen.getByPlaceholderText(/Enter index name/);
    fireEvent.change(confirmInput, { target: { value: "wrong" } });
    let deleteButtons = screen.getAllByRole("button", { name: deleteIndexLabel });
    expect(deleteButtons[deleteButtons.length - 1]).toBeDisabled();

    api.deletePineconeIndex.mockResolvedValueOnce(undefined);
    fireEvent.change(confirmInput, { target: { value: "alpha" } });
    deleteButtons = screen.getAllByRole("button", { name: deleteIndexLabel });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);

    await waitFor(() => {
      expect(api.deletePineconeIndex).toHaveBeenCalledWith("alpha", "token");
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  it("surfaces delete errors", async () => {
    api.deletePineconeIndex.mockRejectedValueOnce("Delete failed");
    render(
      <IndexManagerModal
        open
        token="token"
        indexes={indexes}
        embeddingModels={embeddingModels}
        onClose={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: deleteIndexLabel }));
    fireEvent.change(screen.getByPlaceholderText(/Enter index name/), {
      target: { value: "alpha" },
    });
    const deleteButtons = screen.getAllByRole("button", { name: deleteIndexLabel });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);

    expect(await screen.findByText("Unable to delete index.")).toBeInTheDocument();
  });

  it("handles create flow and validation", async () => {
    const onRefresh = vi.fn();
    render(
      <IndexManagerModal
        open
        token="token"
        indexes={[]}
        embeddingModels={embeddingModels}
        onClose={() => undefined}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByText(/Create new index/)).toBeInTheDocument();

    const nameInput = screen.getByPlaceholderText("research-vault");
    const getVectorTypeSelect = () => screen.getAllByRole("combobox")[0];
    fireEvent.change(nameInput, { target: { value: "index" } });

    fireEvent.change(getVectorTypeSelect(), {
      target: { value: "sparse" },
    });
    let createButtons = screen.getAllByRole("button", { name: /Create index/ });

    api.createPineconeIndex.mockResolvedValueOnce(undefined);
    fireEvent.click(createButtons[createButtons.length - 1]);

    await waitFor(() => {
      expect(api.createPineconeIndex).toHaveBeenCalled();
      expect(onRefresh).toHaveBeenCalled();
    });

    fireEvent.change(nameInput, { target: { value: "index" } });
    fireEvent.change(getVectorTypeSelect(), {
      target: { value: "dense" },
    });
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[1], { target: { value: "dotproduct" } });
    fireEvent.change(selects[2], { target: { value: "gcp" } });
    fireEvent.change(selects[3], { target: { value: "us-central1" } });
    fireEvent.change(screen.getByPlaceholderText("1536"), { target: { value: "1024" } });
    fireEvent.change(screen.getByPlaceholderText("1536"), { target: { value: "" } });

    await waitFor(() => {
      createButtons = screen.getAllByRole("button", { name: /Create index/ });
      const createButton = createButtons[createButtons.length - 1];
      expect(createButton).toBeDisabled();
    });
    expect(screen.getByText(/Enter a dimension to create a dense index/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "From model" }));
    expect(screen.getByText("Select embedding")).toBeInTheDocument();

    act(() => {
      (lastEmbeddingProps?.onSearchChange as (value: string) => void)("embed");
    });

    await waitFor(() => {
      const filtered = lastEmbeddingProps?.filteredModelCatalog as EmbeddingModelInfo[] | undefined;
      expect(filtered?.length).toBe(1);
    });

    act(() => {
      (lastEmbeddingProps?.onSelectModel as (id: string) => void)("emb-1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Manual" }));

    api.createPineconeIndex.mockResolvedValueOnce(undefined);
    createButtons = screen.getAllByRole("button", { name: /Create index/ });
    fireEvent.click(createButtons[createButtons.length - 1]);

    await waitFor(() => {
      expect(api.createPineconeIndex).toHaveBeenCalledTimes(2);
      expect(onRefresh).toHaveBeenCalledTimes(2);
    });

    api.createPineconeIndex.mockRejectedValueOnce(new Error("Boom"));
    fireEvent.change(nameInput, { target: { value: "index" } });
    createButtons = screen.getAllByRole("button", { name: /Create index/ });
    fireEvent.click(createButtons[createButtons.length - 1]);
    expect(await screen.findByText("Boom")).toBeInTheDocument();
  });

  it("switches between index list views", () => {
    render(
      <IndexManagerModal
        open
        token="token"
        indexes={indexes}
        embeddingModels={embeddingModels}
        onClose={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create index" }));
    expect(screen.getByText(/Create new index/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /alpha/i }));
    expect(screen.getByText("Index details")).toBeInTheDocument();
  });

  it("handles escape key dismissal", () => {
    const onClose = vi.fn();
    render(
      <IndexManagerModal
        open
        token="token"
        indexes={indexes}
        embeddingModels={embeddingModels}
        onClose={onClose}
        onRefresh={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: deleteIndexLabel }));
    expect(screen.getByText(/Confirm index deletion/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText(/Confirm index deletion/)).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("renders external error messages", () => {
    render(
      <IndexManagerModal
        open
        token="token"
        indexes={[]}
        embeddingModels={embeddingModels}
        error="Unable to load indexes."
        onClose={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    expect(screen.getByText("Unable to load indexes.")).toBeInTheDocument();
  });
});
