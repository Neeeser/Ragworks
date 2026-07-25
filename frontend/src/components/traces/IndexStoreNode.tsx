"use client";

import { Handle, Position } from "@xyflow/react";
import { Database } from "lucide-react";

import { getPortTypeClasses } from "@/components/pipelines/lib/pipeline-theme";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { Node, NodeProps } from "@xyflow/react";

export type IndexStoreNodeData = {
  indexName: string;
  backend?: string;
  itemFocus?: "traveled" | "absent";
};

const BACKEND_LABELS: Record<string, string> = {
  pgvector: "pgvector",
  pinecone: "Pinecone",
};

/**
 * The shared vector index, rendered as a datastore between the ingestion and
 * retrieval bands of an end-to-end trace. It is deliberately NOT a pipeline
 * card: ingestion writes into it (top handle), retrieval reads from it (bottom
 * handle), and the two pipelines are otherwise fully isolated.
 */
export function IndexStoreNode({ data }: NodeProps<Node<IndexStoreNodeData>>) {
  const portClasses = getPortTypeClasses("indexed_batch");
  return (
    <div
      className={cn(
        "relative flex w-[220px] flex-col items-center rounded-full border border-stage-index/40 bg-stage-index/10 px-4 py-3 text-center shadow-elevation-2",
        data.itemFocus === "traveled" && "border-accent-cyan/70",
        data.itemFocus === "absent" && "opacity-30",
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="write"
        isConnectable={false}
        className={cn("!h-3 !w-3 !rounded-full !border-2 !border-canvas", portClasses.handle)}
      />
      <div className="flex items-center gap-2 text-stage-index">
        <Database className="h-4 w-4" aria-hidden />
        <InstrumentLabel className="text-stage-index">Shared index</InstrumentLabel>
      </div>
      {/* The index name is an identifier — verbatim mono, never a label voice. */}
      <Tooltip content={data.indexName} triggerClassName="mt-1 w-full min-w-0">
        <span className="w-full truncate font-mono text-ui text-primary">{data.indexName}</span>
      </Tooltip>
      {data.backend ? (
        <p className="text-instrument text-muted">{BACKEND_LABELS[data.backend] ?? data.backend}</p>
      ) : null}
      <Handle
        type="source"
        position={Position.Bottom}
        id="read"
        isConnectable={false}
        className={cn("!h-3 !w-3 !rounded-full !border-2 !border-canvas", portClasses.handle)}
      />
    </div>
  );
}

export const INDEX_STORE_NODE_ID = "index::store";
export const traceNodeTypes = { indexStore: IndexStoreNode };
