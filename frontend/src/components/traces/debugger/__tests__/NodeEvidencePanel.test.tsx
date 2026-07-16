import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NodeEvidencePanel } from "@/components/traces/debugger/NodeEvidencePanel";
import { makeNodeRunTrace } from "@/test/fixtures";

import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { TraceStep } from "@/components/traces/trace-graph";
import type { Node } from "@xyflow/react";

const SOURCE_PATH = "/docs/guide.md";
const PARSED_DOCUMENT = "Parsed markdown";
const FULL_PARSED_DOCUMENT = "Parsed markdown with the complete normalized document body.";
const TRACE_TIME = "2024-01-01T00:00:00Z";

const step: TraceStep = {
  nodeId: "parser",
  nodeIds: ["parser"],
  run: makeNodeRunTrace({
    node_id: "parser",
    node_name: "Markdown parser",
    summary: {
      inputs: [{ label: "Source", kind: "text", value: SOURCE_PATH }],
      outputs: [
        {
          label: "Document",
          kind: "text",
          value: { preview: PARSED_DOCUMENT, length: FULL_PARSED_DOCUMENT.length },
        },
      ],
    },
  }),
  io: {
    inputs: [
      {
        id: "io-input",
        run_id: "run",
        node_run_id: "node-run",
        node_id: "parser",
        io_type: "input",
        port: "document",
        payload: { raw_only: "raw parser payload" },
        created_at: TRACE_TIME,
        updated_at: TRACE_TIME,
      },
    ],
    outputs: [
      {
        id: "io-output",
        run_id: "run",
        node_run_id: "node-run",
        node_id: "parser",
        io_type: "output",
        port: "document",
        payload: { document: { text: FULL_PARSED_DOCUMENT } },
        created_at: TRACE_TIME,
        updated_at: TRACE_TIME,
      },
    ],
  },
  stage: "origin",
  stageLabel: "Ingestion",
};

const node: Node<PipelineNodeData> = {
  id: "parser",
  type: "pipelineNode",
  position: { x: 0, y: 0 },
  data: {
    label: "Markdown parser",
    nodeType: "parser.markdown",
    description: "Parse Markdown into normalized text.",
    inputs: [],
    outputs: [],
    config: { mode: "markdown" },
  },
};

describe("NodeEvidencePanel", () => {
  it("keeps explanation, data, configuration, and raw payload in one stable pane", () => {
    render(
      <NodeEvidencePanel
        step={step}
        node={node}
        focusedItemId={null}
        contextItems={[]}
        itemEffect={null}
        inputSources={[]}
      />,
    );

    expect(screen.getByRole("region", { name: "Node evidence" })).toBeInTheDocument();
    expect(screen.getByText("Parse Markdown into normalized text.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Node data" }));
    expect(screen.getByRole("navigation", { name: "Node data fields" })).toBeInTheDocument();
    expect(screen.getByText(PARSED_DOCUMENT)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show full" }));
    expect(screen.getByText(FULL_PARSED_DOCUMENT)).toBeInTheDocument();
    expect(screen.queryByText(SOURCE_PATH)).not.toBeInTheDocument();
    expect(screen.queryByText(/raw parser payload/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Input Source" }));
    expect(screen.getByText(SOURCE_PATH)).toBeInTheDocument();
    expect(screen.queryByText(PARSED_DOCUMENT)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Configuration" }));
    expect(screen.getByText(/markdown/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Raw payload" }));
    expect(
      within(screen.getByRole("tabpanel")).getByText(/"node_id": "parser"/),
    ).toBeInTheDocument();
  });

  it("opens any chunk recorded in the selected node payload", () => {
    const onOpenArtifact = vi.fn();
    const chunkStep: TraceStep = {
      ...step,
      nodeId: "chunker",
      nodeIds: ["chunker"],
      run: makeNodeRunTrace({
        node_id: "chunker",
        node_name: "Token Chunker",
        node_type: "chunker.token",
        summary: {
          inputs: [],
          outputs: [
            {
              label: "Chunk items",
              kind: "items",
              value: { kind: "chunks", items: [{ id: "doc:4", score: null }] },
            },
          ],
        },
      }),
      io: {
        inputs: [],
        outputs: [
          {
            id: "chunk-output",
            run_id: "run",
            node_run_id: "node-run",
            node_id: "chunker",
            io_type: "output",
            port: "chunks",
            payload: {
              chunks: [
                {
                  chunk_id: "doc:4",
                  document_id: "doc",
                  order: 4,
                  text: "The complete fifth chunk.",
                  metadata: { data: { filename: "guide.md" } },
                },
              ],
            },
            created_at: TRACE_TIME,
            updated_at: TRACE_TIME,
          },
        ],
      },
    };
    const chunkNode: Node<PipelineNodeData> = {
      ...node,
      id: "chunker",
      data: {
        ...node.data,
        label: "Token Chunker",
        nodeType: "chunker.token",
        config: { chunk_size: 128, chunk_overlap: 16 },
      },
    };

    render(
      <NodeEvidencePanel
        step={chunkStep}
        node={chunkNode}
        focusedItemId={null}
        contextItems={[]}
        itemEffect={null}
        inputSources={[]}
        onOpenArtifact={onOpenArtifact}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Inspect result doc:4" }));
    fireEvent.click(screen.getByRole("button", { name: "Open chunk" }));
    expect(onOpenArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "doc:4",
        text: "The complete fifth chunk.",
        chunk_count: undefined,
      }),
    );
  });
});
