"use client";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CreateCollectionWizard } from "@/components/collections/list/CreateCollectionWizard";
import * as apiModule from "@/lib/api";
import {
  makeCollection,
  makeDiagnostic,
  makeDiagnosticsSummary,
  makePipeline,
} from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

const namePlaceholder = "Research vault";
const descriptionPlaceholder = "Summarize what this collection is for.";
const createButtonLabel = "Create collection";
const addToolLabel = "Search tool to add";
const ingestionSelectLabel = "Ingestion pipeline";
const collectionName = "Collection";
const keywordSearchName = "Keyword search";
const mismatchTitle = "Embedding models differ";

const ingestion = makePipeline({
  id: "ing-1",
  name: "Ingestion",
  kind: "ingestion",
  definition: {
    nodes: [{ id: "node-1", type: "node.type", name: "Node", config: {} }],
    edges: [],
  },
});
const retrieval = makePipeline({
  id: "ret-1",
  name: "Retrieval",
  kind: "retrieval",
  definition: {
    nodes: [{ id: "node-2", type: "node.type", name: "Node", config: {} }],
    edges: [],
  },
});
const secondTool = makePipeline({
  id: "ret-2",
  name: keywordSearchName,
  kind: "retrieval",
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

/** Bind a retrieval pipeline as a tool through the add picker. */
async function addTool(user: ReturnType<typeof userEvent.setup>, name: string) {
  await pickPipeline(user, addToolLabel, name);
  await user.click(screen.getByRole("button", { name: /Add tool/ }));
}

/**
 * Make both choices the Pipelines step requires. Nothing is preselected, so
 * every test that reaches Review or Create passes through here.
 */
async function choosePipelines(
  user: ReturnType<typeof userEvent.setup>,
  { ingestionName = "Ingestion", toolName = "Retrieval" } = {},
) {
  await pickPipeline(user, ingestionSelectLabel, ingestionName);
  await addTool(user, toolName);
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

  it("creates a collection with the chosen ingestion pipeline and primary tool", async () => {
    const user = userEvent.setup();
    const created = makeCollection();
    api.createCollection.mockResolvedValueOnce(created);
    const { props } = renderWizard();

    await user.type(screen.getByPlaceholderText(namePlaceholder), collectionName);
    await user.type(screen.getByPlaceholderText(descriptionPlaceholder), "Notes");
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await choosePipelines(user);
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

    await choosePipelines(user);
    await addTool(user, keywordSearchName);
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
    await choosePipelines(user);

    await user.click(screen.getByRole("button", { name: "Remove Retrieval" }));

    expect(screen.getByText("Add at least one search tool for chat to call.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /3\s*Review/ })).toBeDisabled();
  });

  it("disables a colliding tool option and names the pipeline already using the name", async () => {
    const user = userEvent.setup();
    renderWizard({ retrievalPipelines: [retrieval, collidingTool, secondTool] });

    await user.type(screen.getByPlaceholderText(namePlaceholder), collectionName);
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await choosePipelines(user);

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
    await choosePipelines(user);
    await pickPipeline(user, addToolLabel, keywordSearchName);

    // A background refetch brings back the same pipeline with its declared
    // tool name dropped, so it now resolves to "search" like the bound one.
    const renamed = { ...secondTool, interface: null };
    rerender(<CreateCollectionWizard {...props} retrievalPipelines={[retrieval, renamed]} />);
    await user.click(screen.getByRole("button", { name: /Add tool/ }));

    expect(await screen.findByText(/would both expose the tool name 'search'/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Remove Keyword search/ })).toBeNull();
  });

  it("blocks the step until an ingestion pipeline and a search tool are both chosen", async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.type(screen.getByPlaceholderText(namePlaceholder), collectionName);
    await user.click(screen.getByRole("button", { name: /Next/ }));

    // Nothing is preselected: a collection runs the pipelines it was created
    // with for its whole life, so both choices are the user's to make.
    expect(screen.getByText("Add at least one search tool for chat to call.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /3\s*Review/ })).toBeDisabled();

    await pickPipeline(user, ingestionSelectLabel, "Ingestion");
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();

    await addTool(user, "Retrieval");
    expect(screen.getByRole("button", { name: /Next/ })).toBeEnabled();
  });

  it("surfaces a create failure without closing the wizard", async () => {
    const user = userEvent.setup();
    api.createCollection.mockRejectedValueOnce(new Error("boom"));
    const { props } = renderWizard();

    await user.type(screen.getByPlaceholderText(namePlaceholder), collectionName);
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await choosePipelines(user);
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await user.click(screen.getByRole("button", { name: createButtonLabel }));

    expect(await screen.findByText("boom")).toBeTruthy();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("warns about the selected pairing on the Pipelines step, without blocking Create", async () => {
    const user = userEvent.setup();
    api.previewCollectionDiagnostics.mockResolvedValue(makeDiagnosticsSummary([makeDiagnostic()]));
    renderWizard();

    await user.type(screen.getByPlaceholderText(namePlaceholder), collectionName);
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await choosePipelines(user);

    expect(await screen.findByText(mismatchTitle)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Next/ })).toBeEnabled();
    // The finding's action would navigate out of the wizard, losing the draft.
    expect(screen.queryByRole("link", { name: /Edit search tool/ })).toBeNull();
  });

  it("clears the warning when the selection changes to a clean pairing", async () => {
    const user = userEvent.setup();
    api.previewCollectionDiagnostics.mockResolvedValueOnce(
      makeDiagnosticsSummary([makeDiagnostic()]),
    );
    api.previewCollectionDiagnostics.mockResolvedValue(makeDiagnosticsSummary([]));
    renderWizard({ retrievalPipelines: [retrieval, secondTool] });

    await user.type(screen.getByPlaceholderText(namePlaceholder), collectionName);
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await choosePipelines(user);
    expect(await screen.findByText(mismatchTitle)).toBeTruthy();

    await addTool(user, keywordSearchName);

    await waitFor(() => {
      expect(screen.queryByText(mismatchTitle)).toBeNull();
    });
  });

  it("shows no warning when the preview request fails", async () => {
    const user = userEvent.setup();
    api.previewCollectionDiagnostics.mockRejectedValue(new Error("offline"));
    renderWizard();

    await user.type(screen.getByPlaceholderText(namePlaceholder), collectionName);
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await choosePipelines(user);

    await waitFor(() => {
      expect(api.previewCollectionDiagnostics).toHaveBeenCalled();
    });
    expect(screen.queryByText("offline")).toBeNull();
    expect(screen.queryByText("Diagnostics")).toBeNull();
    expect(screen.getByRole("button", { name: /Next/ })).toBeEnabled();
  });
});
