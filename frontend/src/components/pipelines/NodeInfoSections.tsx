import { VariablesTree } from "@/components/traces/debugger/VariablesTree";

import type { PipelineNodeData } from "./PipelineNode";
import type { Node } from "@xyflow/react";

/** The node's one-paragraph description, shown first under the drawer header. */
export function NodeDescription({ node }: { node: Node<PipelineNodeData> }) {
  if (!node.data.description) return null;
  return <p className="max-w-[66ch] text-ui leading-relaxed text-body">{node.data.description}</p>;
}

/** Example input/output rendered through the same structured viewer as traces. */
export function NodeExampleSection({ node }: { node: Node<PipelineNodeData> }) {
  const example = node.data.example;
  if (!example) return null;
  return (
    <div className="space-y-3 border-t border-hairline pt-3">
      <VariablesTree
        title="Inputs"
        tone="cyan"
        summaryItems={[{ label: "example", value: example.input, kind: "text" }]}
        ioRecords={[]}
        emptySummaryLabel="No inputs recorded."
      />
      <VariablesTree
        title="Outputs"
        tone="violet"
        summaryItems={[{ label: "example", value: example.output, kind: "text" }]}
        ioRecords={[]}
        emptySummaryLabel="No outputs recorded."
      />
    </div>
  );
}
