import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PipelineInspector } from "@/components/pipelines/PipelineInspector";

import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { EmbeddingModelInfo, PineconeIndex } from "@/lib/types";
import type { Node } from "@xyflow/react";

const parameterInputMock = vi.fn();
let lastEmbeddingProps: Record<string, unknown> | null = null;

vi.mock("@/components/ui/parameter-controls", () => ({
  ParameterFieldCard: ({
    label,
    helper,
    children,
  }: {
    label: string;
    helper?: string | null;
    children: React.ReactNode;
  }) => (
    <div>
      <span>{label}</span>
      {helper && <span>{helper}</span>}
      {children}
    </div>
  ),
  ParameterInput: (props: { input: string; onChange: (value: string | boolean) => void }) => {
    parameterInputMock(props);
    return (
      <button
        type="button"
        onClick={() => {
          if (props.input === "number") props.onChange("1.2");
          else if (props.input === "integer") props.onChange("3");
          else if (props.input === "boolean") props.onChange(true);
          else props.onChange("text");
        }}
      >
        {`trigger-${props.input}`}
      </button>
    );
  },
}));

vi.mock("@/components/pipelines/EmbeddingModelSelectorCard", () => ({
  EmbeddingModelSelectorCard: (props: Record<string, unknown>) => {
    lastEmbeddingProps = props;
    return <div data-testid="embedding-selector" />;
  },
}));

describe("PipelineInspector", () => {
  beforeEach(() => {
    parameterInputMock.mockClear();
    lastEmbeddingProps = null;
  });

  it("shows placeholder when no node is selected", () => {
    render(
      <PipelineInspector
        selectedNode={null}
        configDraft={{}}
        onConfigDraftChange={() => undefined}
        onLabelChange={() => undefined}
        onApplyConfig={() => undefined}
      />,
    );
    expect(screen.getByText(/Select a node/)).toBeInTheDocument();
  });

  it("renders preview mode for embedder nodes", () => {
    const node: Node<PipelineNodeData> = {
      id: "node-1",
      type: "pipelineNode",
      position: { x: 0, y: 0 },
      data: {
        label: "Embedder",
        nodeType: "embedder.openrouter",
        description: "",
        example: { input: "input", output: "output" },
        inputs: [],
        outputs: [],
        config: {},
        configSchema: {
          properties: {
            model_name: { type: "string" },
            dimension: { type: "integer" },
            temperature: { type: "number", default: 0.5 },
          },
        },
      },
    };

    render(
      <PipelineInspector
        selectedNode={node}
        configDraft={{}}
        onConfigDraftChange={() => undefined}
        onLabelChange={() => undefined}
        onApplyConfig={() => undefined}
        isPreview
      />,
    );

    expect(screen.getByText(/Preview only/)).toBeInTheDocument();
    expect(screen.getByTestId("embedding-selector")).toBeInTheDocument();
    expect(screen.getByText(/Temperature/)).toBeInTheDocument();
    expect(screen.getByText("input")).toBeInTheDocument();
    expect(screen.getByText("output")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Apply config/ })).not.toBeInTheDocument();
  });

  it("provides fallback embedding handlers", () => {
    const node: Node<PipelineNodeData> = {
      id: "node-embed",
      type: "pipelineNode",
      position: { x: 0, y: 0 },
      data: {
        label: "Embedder",
        nodeType: "embedder.openrouter",
        description: "",
        inputs: [],
        outputs: [],
        config: {},
        configSchema: {
          properties: {
            model_name: { type: "string" },
            dimension: { type: "integer" },
          },
        },
      },
    };

    render(
      <PipelineInspector
        selectedNode={node}
        configDraft={{}}
        onConfigDraftChange={() => undefined}
        onLabelChange={() => undefined}
        onApplyConfig={() => undefined}
      />,
    );

    expect(lastEmbeddingProps).not.toBeNull();
    expect(() => {
      (lastEmbeddingProps?.onSearchChange as (value: string) => void)("query");
      (lastEmbeddingProps?.onSelectModel as (value: string) => void)("model-1");
      (lastEmbeddingProps?.onSortChange as (value: string) => void)("price");
    }).not.toThrow();
  });

  it("handles config changes and index selection", () => {
    const onConfigDraftChange = vi.fn();
    const onLabelChange = vi.fn();
    const onApplyConfig = vi.fn();
    const onOpenIndexManager = vi.fn();

    const node: Node<PipelineNodeData> = {
      id: "node-2",
      type: "pipelineNode",
      position: { x: 0, y: 0 },
      data: {
        label: "Indexer",
        nodeType: "indexer.pinecone",
        description: "",
        inputs: [],
        outputs: [],
        config: { index_name: "alpha" },
        configSchema: {
          properties: {
            index_name: { type: "string" },
            dimension: { type: "integer" },
            temperature: { type: "number", default: 0.7 },
            enabled: { type: "boolean" },
          },
        },
      },
    };

    const indexes: PineconeIndex[] = [
      { name: "alpha", dimension: 768, metric: "cosine", host: null, spec: null, status: null },
    ];
    const models: EmbeddingModelInfo[] = [];

    render(
      <PipelineInspector
        selectedNode={node}
        configDraft={{ index_name: "alpha" }}
        onConfigDraftChange={onConfigDraftChange}
        onLabelChange={onLabelChange}
        onApplyConfig={onApplyConfig}
        validationErrors={["Error"]}
        applyDisabled
        pineconeIndexes={indexes}
        onOpenIndexManager={onOpenIndexManager}
        embeddingModels={models}
      />,
    );

    const indexSelect = screen.getByRole("combobox");
    fireEvent.change(indexSelect, { target: { value: "__create__" } });
    expect(onOpenIndexManager).toHaveBeenCalled();

    fireEvent.change(indexSelect, { target: { value: "" } });
    expect(onConfigDraftChange).toHaveBeenCalledWith({});

    fireEvent.change(indexSelect, { target: { value: "alpha" } });
    expect(onConfigDraftChange).toHaveBeenCalledWith({ index_name: "alpha", dimension: 768 });

    fireEvent.click(screen.getByText("trigger-number"));
    expect(onConfigDraftChange).toHaveBeenCalled();

    const applyButton = screen.getByRole("button", { name: /Apply config/ });
    expect(applyButton).toBeDisabled();

    fireEvent.change(screen.getByDisplayValue("Indexer"), { target: { value: "New label" } });
    expect(onLabelChange).toHaveBeenCalledWith("New label");

    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("handles integer, boolean, and nullable text inputs", () => {
    const onConfigDraftChange = vi.fn();
    const node: Node<PipelineNodeData> = {
      id: "node-3",
      type: "pipelineNode",
      position: { x: 0, y: 0 },
      data: {
        label: "Parser",
        nodeType: "parser.document",
        description: "",
        inputs: [],
        outputs: [],
        config: {},
        configSchema: {
          properties: {
            retries: { type: "integer", default: 1 },
            enabled: { type: "boolean" },
            note: { type: ["string", "null"] },
          },
        },
      },
    };

    render(
      <PipelineInspector
        selectedNode={node}
        configDraft={{}}
        onConfigDraftChange={onConfigDraftChange}
        onLabelChange={() => undefined}
        onApplyConfig={() => undefined}
      />,
    );

    fireEvent.click(screen.getByText("trigger-integer"));
    expect(onConfigDraftChange).toHaveBeenCalledWith({ retries: 3 });

    fireEvent.click(screen.getByText("trigger-boolean"));
    expect(onConfigDraftChange).toHaveBeenCalledWith({ enabled: true });

    fireEvent.click(screen.getByText("trigger-text"));
    expect(onConfigDraftChange).toHaveBeenCalledWith({ note: "text" });

    const lastProps = parameterInputMock.mock.calls.find(
      ([props]) => props.input === "text",
    )?.[0] as { onChange: (value: string) => void } | undefined;
    lastProps?.onChange("");
    expect(onConfigDraftChange).toHaveBeenCalledWith({});
  });

  it("renders required helpers for missing indexes and fields", () => {
    const node: Node<PipelineNodeData> = {
      id: "node-4",
      type: "pipelineNode",
      position: { x: 0, y: 0 },
      data: {
        label: "Indexer",
        nodeType: "indexer.pinecone",
        description: "",
        inputs: [],
        outputs: [],
        config: {},
        configSchema: {
          required: ["api_key"],
          properties: {
            index_name: { type: "string" },
            api_key: { type: "string" },
          },
        },
      },
    };

    render(
      <PipelineInspector
        selectedNode={node}
        configDraft={{}}
        onConfigDraftChange={() => undefined}
        onLabelChange={() => undefined}
        onApplyConfig={() => undefined}
        pineconeIndexes={[]}
      />,
    );

    expect(screen.getAllByText("Required").length).toBeGreaterThan(0);
  });

  it("renders empty config message for nodes without fields", () => {
    const node: Node<PipelineNodeData> = {
      id: "node-5",
      type: "pipelineNode",
      position: { x: 0, y: 0 },
      data: {
        label: "Empty",
        nodeType: "parser.document",
        description: "",
        inputs: [],
        outputs: [],
        config: {},
        configSchema: {},
      },
    };

    render(
      <PipelineInspector
        selectedNode={node}
        configDraft={{}}
        onConfigDraftChange={() => undefined}
        onLabelChange={() => undefined}
        onApplyConfig={() => undefined}
      />,
    );

    expect(screen.getByText("This node has no configurable settings.")).toBeInTheDocument();
  });

  it("shows index dimension fallback when missing", () => {
    const node: Node<PipelineNodeData> = {
      id: "node-6",
      type: "pipelineNode",
      position: { x: 0, y: 0 },
      data: {
        label: "Indexer",
        nodeType: "indexer.pinecone",
        description: "",
        inputs: [],
        outputs: [],
        config: { index_name: "alpha" },
        configSchema: {
          properties: {
            index_name: { type: "string" },
          },
        },
      },
    };

    render(
      <PipelineInspector
        selectedNode={node}
        configDraft={{ index_name: "alpha" }}
        onConfigDraftChange={() => undefined}
        onLabelChange={() => undefined}
        onApplyConfig={() => undefined}
        pineconeIndexes={[{ name: "alpha", dimension: null, metric: "cosine", host: null }]}
      />,
    );

    expect(screen.getByText("Dimension: n/a")).toBeInTheDocument();
  });

  it("clears invalid numeric values and removes missing dimensions", () => {
    const onConfigDraftChange = vi.fn();
    const node: Node<PipelineNodeData> = {
      id: "node-7",
      type: "pipelineNode",
      position: { x: 0, y: 0 },
      data: {
        label: "Indexer",
        nodeType: "indexer.pinecone",
        description: "",
        inputs: [],
        outputs: [],
        config: { temperature: 0.5 },
        configSchema: {
          properties: {
            temperature: { type: "number" },
            index_name: { type: "string" },
            dimension: { type: "integer" },
          },
        },
      },
    };
    const indexes: PineconeIndex[] = [
      { name: "alpha", dimension: null, metric: "cosine", host: null, spec: null, status: null },
    ];

    render(
      <PipelineInspector
        selectedNode={node}
        configDraft={{ index_name: "alpha" }}
        onConfigDraftChange={onConfigDraftChange}
        onLabelChange={() => undefined}
        onApplyConfig={() => undefined}
        pineconeIndexes={indexes}
      />,
    );

    const numberProps = parameterInputMock.mock.calls.find(
      ([props]) => props.input === "number",
    )?.[0] as { onChange?: (value: string | boolean) => void } | undefined;
    numberProps?.onChange?.("NaN");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "alpha" } });

    const calls = onConfigDraftChange.mock.calls.map(([value]) => value as Record<string, unknown>);
    expect(calls.some((call) => !("temperature" in call))).toBe(true);
    expect(calls.some((call) => call.index_name === "alpha" && !("dimension" in call))).toBe(true);
  });

  it("uses draft values for parameter inputs and clears empty numbers", () => {
    const onConfigDraftChange = vi.fn();
    const node: Node<PipelineNodeData> = {
      id: "node-9",
      type: "pipelineNode",
      position: { x: 0, y: 0 },
      data: {
        label: "Config",
        nodeType: "parser.document",
        description: "",
        inputs: [],
        outputs: [],
        config: {},
        configSchema: {
          properties: {
            temperature: { type: "number", default: 0.7 },
          },
        },
      },
    };

    render(
      <PipelineInspector
        selectedNode={node}
        configDraft={{ temperature: 0.9 }}
        onConfigDraftChange={onConfigDraftChange}
        onLabelChange={() => undefined}
        onApplyConfig={() => undefined}
      />,
    );

    const numberProps = parameterInputMock.mock.calls.find(
      ([props]) => props.input === "number",
    )?.[0] as { value?: unknown; onChange?: (value: string | boolean) => void } | undefined;

    expect(numberProps?.value).toBe(0.9);
    numberProps?.onChange?.("");
    expect(onConfigDraftChange).toHaveBeenCalledWith({});
  });

  it("omits empty-config messaging for embedder nodes", () => {
    const node: Node<PipelineNodeData> = {
      id: "node-8",
      type: "pipelineNode",
      position: { x: 0, y: 0 },
      data: {
        label: "Embedder",
        nodeType: "embedder.openrouter",
        description: "",
        inputs: [],
        outputs: [],
        config: {},
        configSchema: {},
      },
    };

    render(
      <PipelineInspector
        selectedNode={node}
        configDraft={{}}
        onConfigDraftChange={() => undefined}
        onLabelChange={() => undefined}
        onApplyConfig={() => undefined}
      />,
    );

    expect(screen.queryByText("This node has no configurable settings.")).not.toBeInTheDocument();
  });

  it("passes embedder selection state and callbacks", () => {
    const onEmbeddingSearchChange = vi.fn();
    const onSelectEmbeddingModel = vi.fn();
    const onEmbeddingModelSortChange = vi.fn();
    const embeddingModels: EmbeddingModelInfo[] = [{ id: "emb-1", name: "Embed" }];
    const node: Node<PipelineNodeData> = {
      id: "node-10",
      type: "pipelineNode",
      position: { x: 0, y: 0 },
      data: {
        label: "Embedder",
        nodeType: "embedder.openrouter",
        description: "",
        inputs: [],
        outputs: [],
        config: {},
        configSchema: {},
      },
    };

    render(
      <PipelineInspector
        selectedNode={node}
        configDraft={{ model_name: "emb-1" }}
        onConfigDraftChange={() => undefined}
        onLabelChange={() => undefined}
        onApplyConfig={() => undefined}
        embeddingModels={embeddingModels}
        onEmbeddingSearchChange={onEmbeddingSearchChange}
        onSelectEmbeddingModel={onSelectEmbeddingModel}
        embeddingModelSortOption="dimension"
        onEmbeddingModelSortChange={onEmbeddingModelSortChange}
      />,
    );

    expect(lastEmbeddingProps?.selectedModelKey).toBe("emb-1");
    expect(lastEmbeddingProps?.onSearchChange).toBe(onEmbeddingSearchChange);
    expect(lastEmbeddingProps?.onSelectModel).toBe(onSelectEmbeddingModel);
    expect(lastEmbeddingProps?.onSortChange).toBe(onEmbeddingModelSortChange);
  });
});
