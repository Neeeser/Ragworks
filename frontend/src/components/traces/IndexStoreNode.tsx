"use client";

import { Handle, Position } from "@xyflow/react";
import { Database } from "lucide-react";

import { getPortTypeClasses } from "@/components/pipelines/lib/pipeline-theme";
import { cn } from "@/lib/utils";

import type { Node, NodeProps } from "@xyflow/react";

export type IndexStoreNodeData = {
  indexName: string;
  backend?: string;
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
    <div className="relative flex w-[220px] flex-col items-center rounded-full border border-cyan-400/40 bg-cyan-500/10 px-4 py-3 text-center shadow-[0_0_28px_rgba(34,211,238,0.18)]">
      <Handle
        type="target"
        position={Position.Top}
        id="write"
        isConnectable={false}
        className={cn("!h-3 !w-3 !rounded-full !border-2 !border-slate-950", portClasses.handle)}
      />
      <div className="flex items-center gap-2 text-cyan-100">
        <Database className="h-4 w-4" />
        <span className="text-[10px] uppercase tracking-[0.3em] text-cyan-300/80">
          Shared index
        </span>
      </div>
      <p className="mt-1 truncate text-sm font-semibold text-white" title={data.indexName}>
        {data.indexName}
      </p>
      {data.backend ? (
        <p className="text-[10px] text-cyan-200/70">
          {BACKEND_LABELS[data.backend] ?? data.backend}
        </p>
      ) : null}
      <Handle
        type="source"
        position={Position.Bottom}
        id="read"
        isConnectable={false}
        className={cn("!h-3 !w-3 !rounded-full !border-2 !border-slate-950", portClasses.handle)}
      />
    </div>
  );
}

export const INDEX_STORE_NODE_ID = "index::store";
export const traceNodeTypes = { indexStore: IndexStoreNode };
