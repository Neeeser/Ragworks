import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BindingIndexDialog } from "../BindingIndexDialog";
import { ApiError } from "@/lib/api-error";
import { makePipeline } from "@/test/fixtures";
import { makeVectorIndex } from "@/test/fixtures/indexes";

import type { Pipeline, PipelineVariable } from "@/lib/types";

const PRIMARY_INDEX: PipelineVariable = {
  name: "primary_index",
  type: "index",
  source: "binding",
  description: "Vector index this pipeline uses",
  value: { index_id: "index-row-1", backend: "pgvector", name: "docs-main" },
};

function pipelineWithIndexSlot(variables: PipelineVariable[] = [PRIMARY_INDEX]): Pipeline {
  const pipeline = makePipeline();
  return { ...pipeline, definition: { ...pipeline.definition, variables } };
}

function renderDialog(overrides: Partial<Parameters<typeof BindingIndexDialog>[0]> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <BindingIndexDialog
      open
      pipeline={pipelineWithIndexSlot()}
      values={{}}
      indexes={[
        makeVectorIndex({ index_id: "index-row-1", name: "docs-main" }),
        makeVectorIndex({ index_id: "index-row-2", name: "tenant-b", backend: "pinecone" }),
      ]}
      title="search_docs"
      onSave={onSave}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onSave, onClose };
}

describe("BindingIndexDialog", () => {
  it("saves the picked index against its variable name", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog();

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /tenant-b/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        primary_index: {
          index_id: "index-row-2",
          backend: "pinecone",
          name: "tenant-b",
        },
      }),
    );
  });

  it("warns that changing the index does not move indexed data", () => {
    renderDialog();

    expect(screen.getByText(/does not move indexed data/i)).toBeInTheDocument();
  });

  it("shows the backend-incompatibility message the API returns", async () => {
    const user = userEvent.setup();
    const onSave = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          400,
          "Node 'facet' (facet.bm25) does not run on pinecone; it requires pgvector.",
        ),
      );
    renderDialog({ onSave });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/does not run on pinecone/)).toBeInTheDocument();
  });

  it("keeps the dialog open when saving fails", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error("nope"));
    const { onClose } = renderDialog({ onSave });

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("reports a pipeline with no index slot instead of an empty picker", () => {
    renderDialog({ pipeline: pipelineWithIndexSlot([]) });

    expect(screen.getByText(/no index to choose/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
