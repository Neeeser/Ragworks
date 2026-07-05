import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IndexManagerModal } from "@/components/pipelines/index-manager/IndexManagerModal";
import * as apiModule from "@/lib/api";
import { makePineconeIndex } from "@/test/fixtures";

import type { EmbeddingModelInfo, PineconeIndex } from "@/lib/types";

let lastEmbeddingProps: Record<string, unknown> | null = null;
const deleteIndexLabel = "Delete index";
const createIndexName = "index";
const confirmDeletionText = /Confirm index deletion/;
const createIndexButtonName = /Create index/;

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

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

const api = vi.mocked(apiModule);

describe("IndexManagerModal", () => {
  const indexes: PineconeIndex[] = [
    makePineconeIndex({ name: "alpha", dimension: 768, host: "host", status: { state: "READY" } }),
  ];

  const embeddingModels: EmbeddingModelInfo[] = [
    { id: "emb-1", name: "Embed", dimension: 1536 },
    { id: "emb-2", name: "Other", dimension: 1024 },
  ];

  const lastButton = (name: string | RegExp) => {
    const buttons = screen.getAllByRole("button", { name });
    return buttons[buttons.length - 1];
  };

  beforeEach(() => {
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
    const user = userEvent.setup();
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
    await user.click(screen.getByRole("button", { name: deleteIndexLabel }));

    expect(screen.getByText(confirmDeletionText)).toBeInTheDocument();
    const overlays = screen.getAllByRole("presentation");
    await user.click(overlays[overlays.length - 1]);
    await waitFor(() => {
      expect(screen.queryByText(confirmDeletionText)).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: deleteIndexLabel }));
    expect(screen.getByText(confirmDeletionText)).toBeInTheDocument();
    const confirmInput = screen.getByLabelText(/Type/);
    await user.type(confirmInput, "wrong");
    expect(lastButton(deleteIndexLabel)).toBeDisabled();

    api.deletePineconeIndex.mockResolvedValueOnce({ status: "deleted" });
    await user.clear(confirmInput);
    await user.type(confirmInput, "alpha");
    await user.click(lastButton(deleteIndexLabel));

    await waitFor(() => {
      expect(api.deletePineconeIndex).toHaveBeenCalledWith("token", "alpha");
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  it("surfaces delete errors", async () => {
    const user = userEvent.setup();
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

    await user.click(screen.getByRole("button", { name: deleteIndexLabel }));
    await user.type(screen.getByLabelText(/Type/), "alpha");
    await user.click(lastButton(deleteIndexLabel));

    expect(await screen.findByText("Unable to delete index.")).toBeInTheDocument();
  });

  it("handles create flow and validation", async () => {
    const user = userEvent.setup();
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
    await user.type(nameInput, createIndexName);

    await user.selectOptions(getVectorTypeSelect(), "sparse");

    api.createPineconeIndex.mockResolvedValueOnce(makePineconeIndex());
    await user.click(lastButton(createIndexButtonName));

    await waitFor(() => {
      expect(api.createPineconeIndex).toHaveBeenCalled();
      expect(onRefresh).toHaveBeenCalled();
    });

    await user.clear(nameInput);
    await user.type(nameInput, createIndexName);
    await user.selectOptions(getVectorTypeSelect(), "dense");
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[1], "dotproduct");
    await user.selectOptions(selects[2], "gcp");
    await user.selectOptions(selects[3], "us-central1");
    const dimensionInput = screen.getByPlaceholderText("1536");
    await user.type(dimensionInput, "1024");
    await user.clear(dimensionInput);

    await waitFor(() => {
      expect(lastButton(createIndexButtonName)).toBeDisabled();
    });
    expect(screen.getByText(/Enter a dimension to create a dense index/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "From model" }));
    expect(screen.getByText("Select embedding")).toBeInTheDocument();

    // Search/sort are now owned internally by EmbeddingModelSelectorCard; the modal
    // just forwards the raw catalog.
    const models = lastEmbeddingProps?.models as EmbeddingModelInfo[] | undefined;
    expect(models).toEqual(embeddingModels);

    act(() => {
      (lastEmbeddingProps?.onSelectModel as (id: string) => void)("emb-1");
    });

    await user.click(screen.getByRole("button", { name: "Manual" }));

    api.createPineconeIndex.mockResolvedValueOnce(makePineconeIndex());
    await user.click(lastButton(createIndexButtonName));

    await waitFor(() => {
      expect(api.createPineconeIndex).toHaveBeenCalledTimes(2);
      expect(onRefresh).toHaveBeenCalledTimes(2);
    });

    api.createPineconeIndex.mockRejectedValueOnce(new Error("Boom"));
    await user.clear(nameInput);
    await user.type(nameInput, createIndexName);
    await user.click(lastButton(createIndexButtonName));
    expect(await screen.findByText("Boom")).toBeInTheDocument();
  });

  it("clears a stale error banner when a create retry succeeds", async () => {
    const user = userEvent.setup();
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

    const nameInput = screen.getByPlaceholderText("research-vault");
    await user.type(nameInput, createIndexName);

    api.createPineconeIndex.mockRejectedValueOnce(new Error("Boom"));
    await user.click(lastButton(createIndexButtonName));
    expect(await screen.findByText("Boom")).toBeInTheDocument();

    api.createPineconeIndex.mockResolvedValueOnce(makePineconeIndex());
    await user.click(lastButton(createIndexButtonName));

    await waitFor(() => {
      expect(screen.getByText("Index created.")).toBeInTheDocument();
      expect(screen.queryByText("Boom")).not.toBeInTheDocument();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("switches between index list views", async () => {
    const user = userEvent.setup();
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

    await user.click(screen.getByRole("button", { name: "Create index" }));
    expect(screen.getByText(/Create new index/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /alpha/i }));
    expect(screen.getByText("Index details")).toBeInTheDocument();
  });

  it("handles escape key dismissal", async () => {
    const user = userEvent.setup();
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

    await user.click(screen.getByRole("button", { name: deleteIndexLabel }));
    expect(screen.getByText(confirmDeletionText)).toBeInTheDocument();

    // First Escape closes only the topmost dialog (the delete confirmation); the
    // index manager itself stays open.
    await user.keyboard("{Escape}");
    expect(screen.queryByText(confirmDeletionText)).not.toBeInTheDocument();
    expect(screen.getByText("Pinecone index manager")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
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
