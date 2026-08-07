import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDraftRun } from "@/components/pipelines/hooks/use-draft-run";
import { RunPanelOverlay } from "@/components/pipelines/RunPanelOverlay";
import * as apiModule from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { formatApiErrorDetail } from "@/lib/errors";
import { makeCollection, makeNodeRunTrace, makeTraceResponse } from "@/test/fixtures";

import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { Node } from "@xyflow/react";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const api = vi.mocked(apiModule);

const QUERY_NODE_TYPE = "retrieval.input";
const EMBEDDER = "Embedder";
const RETRIEVER = "Dense retriever";
const FAILURE_MESSAGE = "Retrieval failed at Embedder. The provider is unavailable.";

const NODES: Node<PipelineNodeData>[] = [
  {
    id: "query",
    type: "pipelineNode",
    position: { x: 0, y: 0 },
    data: { label: "Query", nodeType: QUERY_NODE_TYPE, config: {}, inputs: [], outputs: [] },
  },
];

const COLLECTIONS = [
  makeCollection({ id: "col-1", name: "Docs" }),
  makeCollection({ id: "col-2", name: "Archive" }),
];

/** Mounts the panel on the real hook, so the wiring under test is the real one. */
function Harness() {
  const run = useDraftRun({
    token: "t",
    pipelineId: "pipe-1",
    nodes: NODES,
    edges: [],
    variables: [],
    collections: COLLECTIONS,
  });
  return <RunPanelOverlay run={run} nodeSpecs={[]} onClose={() => undefined} />;
}

const runQuery = async (text = "capital of France") => {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Sample query"), text);
  await user.click(screen.getByRole("button", { name: "Run" }));
  return user;
};

describe("RunPanelOverlay", () => {
  beforeEach(() => {
    api.runPipelineDraft.mockResolvedValue({ trace: makeTraceResponse() });
  });

  it("runs the graph on the canvas, not the pipeline's saved definition", async () => {
    render(<Harness />);

    await runQuery();

    await waitFor(() => expect(api.runPipelineDraft).toHaveBeenCalled());
    const [, , payload] = api.runPipelineDraft.mock.calls[0];
    expect(payload.collection_id).toBe("col-1");
    expect(payload.query).toBe("capital of France");
    // The graph on the canvas travels on the request — nothing is saved first.
    expect(payload.definition.nodes).toEqual([
      expect.objectContaining({ id: "query", type: QUERY_NODE_TYPE }),
    ]);
  });

  it("renders the returned trace per node, not just a results list", async () => {
    api.runPipelineDraft.mockResolvedValue({
      trace: makeTraceResponse({
        node_runs: [makeNodeRunTrace({ node_id: "retriever", node_name: RETRIEVER })],
      }),
    });
    render(<Harness />);

    await runQuery();

    // The node reaches both panes: the execution order on the left and the
    // evidence pane showing what that step actually did.
    const ledger = await screen.findByRole("navigation", { name: "Execution order" });
    expect(within(ledger).getByText(RETRIEVER)).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Node evidence" })).getByText(RETRIEVER),
    ).toBeInTheDocument();
  });

  it("states why a refused draft was refused instead of failing silently", async () => {
    const refusal = {
      message: "This draft cannot run until its errors are fixed.",
      code: "pipeline_draft_invalid",
      errors: ["Edge 'broken' targets a port no node declares."],
      issues: [],
    };
    // `apiFetch` builds the thrown error's message with `formatApiErrorDetail`,
    // so the panel must render the refusal's own sentence ahead of the graph
    // findings however it reaches the surface.
    api.runPipelineDraft.mockRejectedValue(
      new ApiError(400, formatApiErrorDetail(refusal), refusal),
    );
    render(<Harness />);

    await runQuery();

    const lead = await screen.findByText("This draft cannot run until its errors are fixed.");
    const finding = screen.getByText("Edge 'broken' targets a port no node declares.");
    expect(lead.compareDocumentPosition(finding) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("states a refusal that names no finding at all", async () => {
    const refusal = {
      message:
        "This pipeline has no query input, so there is nothing to run a sample query through.",
      code: "pipeline_draft_invalid",
      errors: [],
      issues: [],
    };
    api.runPipelineDraft.mockRejectedValue(
      new ApiError(400, formatApiErrorDetail(refusal), refusal),
    );
    render(<Harness />);

    await runQuery();

    expect(await screen.findByText(refusal.message)).toBeInTheDocument();
  });

  it("shows the failed run's trace alongside the failure that ended it", async () => {
    api.runPipelineDraft.mockResolvedValue({
      trace: makeTraceResponse({
        run: { ...makeTraceResponse().run, status: "failed" },
        node_runs: [makeNodeRunTrace({ node_id: "embed", node_name: EMBEDDER, status: "failed" })],
      }),
      failure: {
        message: FAILURE_MESSAGE,
        code: "retrieval_pipeline_failed",
        failed_node: { node_id: "embed", node_name: EMBEDDER, node_type: "embedding.model" },
      },
    });
    render(<Harness />);

    await runQuery();

    expect(await screen.findByRole("alert")).toHaveTextContent(FAILURE_MESSAGE);
    // The trace still renders: which node failed is the answer being asked for.
    const ledger = screen.getByRole("navigation", { name: "Execution order" });
    expect(within(ledger).getByText(EMBEDDER)).toBeInTheDocument();
  });

  it("runs against the collection the user picks", async () => {
    render(<Harness />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("combobox", { name: /collection/i }));
    await user.click(await screen.findByRole("option", { name: "Archive" }));
    await runQuery();

    await waitFor(() =>
      expect(api.runPipelineDraft).toHaveBeenCalledWith(
        "t",
        "pipe-1",
        expect.objectContaining({ collection_id: "col-2" }),
      ),
    );
  });

  it("refuses to run with no query, so an empty run never reaches the server", async () => {
    render(<Harness />);

    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(api.runPipelineDraft).not.toHaveBeenCalled();
  });
});
