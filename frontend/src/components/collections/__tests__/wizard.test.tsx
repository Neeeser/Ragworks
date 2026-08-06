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
const addToolLabel = "Retrieval pipeline to add as a tool";
const collectionName = "Collection";
const keywordSearchName = "Keyword search";

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
  name: keywordSearchName,
  kind: "retrieval",
  is_default: false,
  definition: {
    nodes: [{ id: "node-3", type: "node.type", name: "Node", config: {} }],
    edges: [],
  },
  // A distinct declared tool name -- otherwise it defaults to "search",
  // colliding with `retrieval` (also undeclared) under the wizard's
  // pre-submit collision check.
  interface: {
    accepts_document: false,
    callable: true,
    tool_name: "keyword_search",
    output_fields: [],
  },
});
const collidingTool = makePipeline({
  id: "ret-3",
  name: "Duplicate Search",
  kind: "retrieval",
  is_default: false,
  definition: {
    nodes: [{ id: "node-4", type: "node.type", name: "Node", config: {} }],
    edges: [],
  },
  // No declared tool_name -- defaults to "search", the same as `retrieval`.
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

    await user.type(screen.getByPlaceholderText(namePlaceholder), collectionName);

    expect(screen.getByRole("button", { name: /Next/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /2\s*Pipelines/ })).toBeEnabled();
  });

  it("creates a collection with the default ingestion pipeline and primary tool", async () => {
    const user = userEvent.setup();
    const created = makeCollection();
    api.createCollection.mockResolvedValueOnce(created);
    const { props } = renderWizard();

    await user.type(screen.getByPlaceholderText(namePlaceholder), collectionName);
    await user.type(screen.getByPlaceholderText(descriptionPlaceholder), "Notes");
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await user.click(screen.getByRole("button", { name: createButtonLabel }));

    await waitFor(() => {
      expect(api.createCollection).toHaveBeenCalledWith("token", {
        name: collectionName,
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

    await user.type(screen.getByPlaceholderText(namePlaceholder), collectionName);
    await user.click(screen.getByRole("button", { name: /Next/ }));

    await pickPipeline(user, addToolLabel, keywordSearchName);
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

    await user.type(screen.getByPlaceholderText(namePlaceholder), collectionName);
    await user.click(screen.getByRole("button", { name: /Next/ }));

    await user.click(screen.getByRole("button", { name: "Remove Retrieval" }));

    expect(screen.getByText("Add at least one retrieval pipeline for chat to call.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /3\s*Review/ })).toBeDisabled();
  });

  it("disables a colliding tool option and names the pipeline already using the name", async () => {
    const user = userEvent.setup();
    renderWizard({ retrievalPipelines: [retrieval, collidingTool, secondTool] });

    await user.type(screen.getByPlaceholderText(namePlaceholder), collectionName);
    await user.click(screen.getByRole("button", { name: /Next/ }));

    await user.click(screen.getByRole("button", { name: addToolLabel }));
    const colliding = screen.getByRole("option", { name: /Duplicate Search/ });
    expect(colliding).toHaveAttribute("aria-disabled", "true");
    expect(colliding.textContent).toContain("tool name 'search' already used by Retrieval");
    expect(screen.getByRole("option", { name: /Keyword search/ })).not.toHaveAttribute(
      "aria-disabled",
    );

    // The picker refuses the click outright: the trigger still holds no
    // pipeline, so the collision never reaches the Add backstop.
    await user.click(colliding);
    expect(screen.getByRole("button", { name: addToolLabel })).toHaveTextContent(
      "Select a pipeline",
    );

    await user.click(screen.getByRole("button", { name: /Add tool/ }));
    expect(screen.queryByRole("button", { name: /Remove Duplicate Search/ })).toBeNull();
  });

  it("refuses a selected tool whose name starts colliding when the pipeline list reloads", async () => {
    const user = userEvent.setup();
    const { rerender, props } = renderWizard({ retrievalPipelines: [retrieval, secondTool] });

    await user.type(screen.getByPlaceholderText(namePlaceholder), collectionName);
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await pickPipeline(user, addToolLabel, keywordSearchName);

    // A background refetch brings back the same pipeline with its declared
    // tool name dropped, so it now resolves to "search" like the bound one.
    const renamed = { ...secondTool, interface: null };
    rerender(<CreateCollectionWizard {...props} retrievalPipelines={[retrieval, renamed]} />);
    await user.click(screen.getByRole("button", { name: /Add tool/ }));

    expect(await screen.findByText(/would both expose the tool name 'search'/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Remove Keyword search/ })).toBeNull();
  });

  it("fills pipeline defaults when the pipeline lists load after opening", async () => {
    const user = userEvent.setup();
    api.createCollection.mockResolvedValueOnce(makeCollection());
    const { rerender, props } = renderWizard({
      ingestionPipelines: [],
      retrievalPipelines: [],
    });

    await user.type(screen.getByPlaceholderText(namePlaceholder), collectionName);
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

    await user.type(screen.getByPlaceholderText(namePlaceholder), collectionName);
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await user.click(screen.getByRole("button", { name: createButtonLabel }));

    expect(await screen.findByText("boom")).toBeTruthy();
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
