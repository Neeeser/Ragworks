import type { SetupStepId } from "./setup-wizard-reducer";
import type { TypedEdgeType } from "@/components/pipelines/flow/TypedEdge";
import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { NodePort } from "@/lib/types";
import type { Node } from "@xyflow/react";

/**
 * The setup wizard's backdrop pipeline is *synthetic*: one hand-authored node
 * per wizard step, laid out left to right in step order, so the camera only
 * ever flies forward (or back) along the line as the user advances. The nodes
 * are fake — they name the setup steps, not real pipeline stages — but they
 * render through the real `PipelineNode` component and reuse the editor's
 * port-color language so the backdrop still reads as the product.
 */

type SetupPort = { key: string; label: string; dataType: string };

type SetupNode = {
  /** Node id doubles as the wizard step it narrates. */
  id: SetupStepId;
  /** Prefix (before the dot) drives the node's color family in PipelineNode. */
  nodeType: string;
  label: string;
  description: string;
  input?: SetupPort;
  output?: SetupPort;
};

const SETUP_NODES: SetupNode[] = [
  {
    id: "welcome",
    nodeType: "ingestion.workspace",
    label: "Welcome",
    description: "Your workspace comes online.",
    output: { key: "workspace", label: "Workspace", dataType: "document_source" },
  },
  {
    id: "key",
    nodeType: "utility.credentials",
    label: "API key",
    description: "Connect OpenRouter for models.",
    input: { key: "workspace", label: "Workspace", dataType: "document_source" },
    output: { key: "access", label: "Provider access", dataType: "document" },
  },
  {
    id: "model",
    nodeType: "embedder.openrouter",
    label: "Embedding model",
    description: "Pick the model that makes vectors.",
    input: { key: "access", label: "Provider access", dataType: "document" },
    output: { key: "embeddings", label: "Embeddings", dataType: "embedded_batch" },
  },
  {
    id: "index",
    nodeType: "indexer.vector",
    label: "Vector index",
    description: "Choose where vectors live.",
    input: { key: "embeddings", label: "Embeddings", dataType: "embedded_batch" },
    output: { key: "indexed", label: "Index", dataType: "indexed_batch" },
  },
  {
    id: "launch",
    nodeType: "chat.completion",
    label: "Launch",
    description: "Scaffold defaults and start chatting.",
    input: { key: "indexed", label: "Index", dataType: "indexed_batch" },
  },
];

/** Matches the pipeline editor's scaffold spacing so the graph reads familiarly. */
const NODE_SPACING_X = 368;

const toPort = (port: SetupPort): NodePort => ({
  key: port.key,
  label: port.label,
  data_type: port.dataType,
  required: true,
});

export type SetupFlow = {
  nodes: Node<PipelineNodeData>[];
  edges: TypedEdgeType[];
};

/** Build the synthetic setup-step pipeline graph. Pure — safe to memoize once. */
export function buildSetupFlow(): SetupFlow {
  const nodes: Node<PipelineNodeData>[] = SETUP_NODES.map((node, index) => ({
    id: node.id,
    type: "pipelineNode",
    position: { x: NODE_SPACING_X * index, y: 0 },
    data: {
      label: node.label,
      nodeType: node.nodeType,
      description: node.description,
      inputs: node.input ? [toPort(node.input)] : [],
      outputs: node.output ? [toPort(node.output)] : [],
      config: {},
    },
  }));

  const edges: TypedEdgeType[] = [];
  for (let i = 0; i < SETUP_NODES.length - 1; i += 1) {
    const source = SETUP_NODES[i];
    const target = SETUP_NODES[i + 1];
    if (!source.output || !target.input) continue;
    edges.push({
      id: `${source.id}-${target.id}`,
      source: source.id,
      target: target.id,
      sourceHandle: source.output.key,
      targetHandle: target.input.key,
      type: "typed",
      // Wire color comes from the upstream output port, as toFlowEdges does.
      data: { dataType: source.output.dataType },
    });
  }

  return { nodes, edges };
}
