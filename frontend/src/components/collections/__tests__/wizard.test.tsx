"use client";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CreateCollectionWizard } from "@/components/collections/list/CreateCollectionWizard";
import * as apiModule from "@/lib/api";
import { makeCollection, makePipeline } from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

const namePlaceholder = "Research vault";
const descriptionPlaceholder = "Summarize what this collection is for.";
const createButtonLabel = "Create collection";

const ingestion = makePipeline({
  id: "ing-1",
  name: "Ingestion",
  kind: "ingestion",
  is_default: true,
  definition: {
    nodes: [{ id: "node-1", type: "node.type", name: "Node", config: {} }],
    edges: [],
  },
});
const retrieval = makePipeline({
  id: "ret-1",
  name: "Retrieval",
  kind: "retrieval",
  is_default: true,
  definition: {
    nodes: [{ id: "node-2", type: "node.type", name: "Node", config: {} }],
    edges: [],
  },
});
const secondTool = makePipeline({
  id: "ret-2",
  name: "Keyword search",
  kind: "retrieval",
  is_default: false,
  definition: {
    nodes: [{ id: "node-3", type: "node.type", name: "Node", config: {} }],
    edges: [],
  },
});

function renderWizard(overrides: Partial<Parameters<typeof CreateCollectionWizard>[0]> = {}) {
  const props = {
    open: true as const,
    token: "token",
    ingestionPipelines: [ingestion],
    retrievalPipelines: [retrieval],
    onClose: vi.fn(),
    onCreated: vi.fn(),
    ...overrides,
  };
  return { ...render(<CreateCollectionWizard {...props} />), props };
}

/** Choose an option inside a `PipelineSelect` identified by its trigger label. */
async function pickPipeline(user: ReturnType<typeof userEvent.setup>, label: string, name: string) {
  await user.click(screen.getByRole("button", { name: label }));
  await user.click(screen.getByRole("option", { name: new RegExp(name) }));
}

describe("CreateCollectionWizard", () => {
  it("returns null when closed", () => {
    const { container } = renderWizard({ open: false });
    expect(container.firstChild).toBeNull();
  });

  it("blocks both Next and the step list until the collection is named", async () => {
    const user = userEvent.setup();
    renderWizard();

    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /2\s*Pipelines/ })).toBeDisabled();

    await user.type(screen.getByPlaceholderText(namePlaceholder), "Collection");

    expect(screen.getByRole("button", { name: /Next/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /2\s*Pipelines/ })).toBeEnabled();
  });

  it("creates a collection with the default ingestion pipeline and primary tool", async () => {
    const user = userEvent.setup();
    const created = makeCollection();
    api.createCollection.mockResolvedValueOnce(created);
    const { props } = renderWizard();

    await user.type(screen.getByPlaceholderText(namePlaceholder), "Collection");
    await user.type(screen.getByPlaceholderText(descriptionPlaceholder), "Notes");
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await user.click(screen.getByRole("button", { name: createButtonLabel }));

    await waitFor(() => {
      expect(api.createCollection).toHaveBeenCalledWith("token", {
        name: "Collection",
        description: "Notes",
        ingest_pipeline_id: "ing-1",
        tool_pipeline_ids: ["ret-1"],
      });
    });
    expect(props.onCreated).toHaveBeenCalledWith(created);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("binds extra tool pipelines in order, with the promoted one first", async () => {
    const user = userEvent.setup();
    api.createCollection.mockResolvedValueOnce(makeCollection());
    renderWizard({ retrievalPipelines: [retrieval, secondTool] });

    await user.type(screen.getByPlaceholderText(namePlaceholder), "Collection");
    await user.click(screen.getByRole("button", { name: /Next/ }));

    await pickPipeline(user, "Retrieval pipeline to add as a tool", "Keyword search");
    await user.click(screen.getByRole("button", { name: /Add tool/ }));
    await user.click(screen.getByRole("button", { name: "Make primary" }));

    await user.click(screen.getByRole("button", { name: /Next/ }));
    await user.click(screen.getByRole("button", { name: createButtonLabel }));

    await waitFor(() => {
      expect(api.createCollection).toHaveBeenCalledWith(
        "token",
        expect.objectContaining({ tool_pipeline_ids: ["ret-2", "ret-1"] }),
      );
    });
  });

  it("removes a bound tool and blocks the step when none are left", async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.type(screen.getByPlaceholderText(namePlaceholder), "Collection");
    await user.click(screen.getByRole("button", { name: /Next/ }));

    await user.click(screen.getByRole("button", { name: "Remove Retrieval" }));

    expect(screen.getByText("Add at least one retrieval pipeline for chat to call.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /3\s*Review/ })).toBeDisabled();
  });

  it("fills pipeline defaults when the pipeline lists load after opening", async () => {
    const user = userEvent.setup();
    api.createCollection.mockResolvedValueOnce(makeCollection());
    const { rerender, props } = renderWizard({
      ingestionPipelines: [],
      retrievalPipelines: [],
    });

    await user.type(screen.getByPlaceholderText(namePlaceholder), "Collection");
    rerender(
      <CreateCollectionWizard
        {...props}
        ingestionPipelines={[ingestion]}
        retrievalPipelines={[retrieval]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Next/ }));
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await user.click(screen.getByRole("button", { name: createButtonLabel }));

    await waitFor(() => {
      expect(api.createCollection).toHaveBeenCalledWith(
        "token",
        expect.objectContaining({ ingest_pipeline_id: "ing-1", tool_pipeline_ids: ["ret-1"] }),
      );
    });
  });

  it("surfaces a create failure without closing the wizard", async () => {
    const user = userEvent.setup();
    api.createCollection.mockRejectedValueOnce(new Error("boom"));
    const { props } = renderWizard();

    await user.type(screen.getByPlaceholderText(namePlaceholder), "Collection");
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await user.click(screen.getByRole("button", { name: createButtonLabel }));

    expect(await screen.findByText("boom")).toBeTruthy();
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
