"use client";

import { useStore } from "@xyflow/react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { useFlowNodeActive, useFlowPlaybackTiming } from "./flow/active-nodes-context";
import { BEAM_CORNER_RADIUS } from "./flow/flow-timing";
import { PineconeIcon } from "./icons/PineconeIcon";
import { PostgresIcon } from "./icons/PostgresIcon";
import { countHiddenOverrides, resolveNodeSignature } from "./lib/node-signature";
import { buildPipelineConfigFields } from "./lib/pipeline-config";
import { getNodeFamilyLabel, getNodeFamilyStyles, resolveNodeFamily } from "./lib/pipeline-theme";
// The port-type helpers moved out with PortRow; this file no longer draws a port.
import { NodeSelectionToolbar } from "./NodeSelectionToolbar";
import { PortRow, ROLE_LABEL_MIN_ZOOM } from "./PortRow";

import type { ConnectingContext } from "./lib/pipeline-io";
import type { NodeSpec, PipelineRunStatus } from "@/lib/types";
import type { Node, NodeProps } from "@xyflow/react";

export type PipelineNodeExample = {
  input: string;
  output: string;
};

export type DropPreviewNodeData = {
  label?: string;
};

export type { ConnectingContext } from "./lib/pipeline-io";

export type PipelineNodeData = {
  label: string;
  nodeType: string;
  description?: string;
  example?: PipelineNodeExample;
  inputs: NodeSpec["input_ports"];
  outputs: NodeSpec["output_ports"];
  config: Record<string, unknown>;
  configSchema?: Record<string, unknown>;
  /** The selected model widens this node's `accepts` beyond its floor. */
  modelWidensAccepts?: boolean;
  status?: PipelineRunStatus;
  /** Trace debugger result focus; absent outside focused trace playback. */
  itemFocus?: "traveled" | "absent";
  active?: boolean;
  connecting?: ConnectingContext | null;
  errors?: string[];
};

const BACKEND_ICONS = {
  pinecone: PineconeIcon,
  pgvector: PostgresIcon,
} as const;

const statusBadge = (status: PipelineRunStatus) => {
  if (status === "completed") {
    return (
      <span className="flex items-center gap-1 text-instrument font-medium leading-4 text-data-pos">
        <Check className="h-3 w-3" aria-hidden /> Done
      </span>
    );
  }
  if (status === "degraded") {
    // Amber, beside Done's green: the node produced output, so a green badge
    // here is the whole bug — a step that never executed reading as a step
    // that did.
    return (
      <span className="flex items-center gap-1 text-instrument font-medium leading-4 text-data-warn">
        <AlertTriangle className="h-3 w-3" aria-hidden /> Degraded
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex items-center gap-1 text-instrument font-medium leading-4 text-data-neg">
        <AlertTriangle className="h-3 w-3" aria-hidden /> Failed
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-instrument font-medium leading-4 text-accent-cyan">
      <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden /> Running
    </span>
  );
};

/** Fallback card size until the ResizeObserver delivers a measurement. */
const BEAM_FALLBACK_SIZE = { width: 264, height: 120 };

/**
 * One beam route from the card's entry midpoint to its exit midpoint —
 * `over` runs up and across the top edge, `under` mirrors it along the
 * bottom. The two routes are exact mirrors, so equal-duration linear
 * traversals keep both beam heads on the same horizontal progress at all
 * times and land them on the exit point simultaneously.
 */
const buildBeamPath = (width: number, height: number, side: "over" | "under"): string => {
  const r = Math.min(BEAM_CORNER_RADIUS, width / 2, height / 2);
  const mid = height / 2;
  if (side === "over") {
    return `M 0,${mid} L 0,${r} Q 0,0 ${r},0 L ${width - r},0 Q ${width},0 ${width},${r} L ${width},${mid}`;
  }
  return `M 0,${mid} L 0,${height - r} Q 0,${height} ${r},${height} L ${width - r},${height} Q ${width},${height} ${width},${height - r} L ${width},${mid}`;
};

/**
 * The active node's progress beams: the incoming line splits at the entry
 * side into two light segments — one riding over the top of the card, one
 * under the bottom — that stay horizontally in step and meet at the exit
 * side in exactly one process window (globals.css `pipeline-node-beam`,
 * a single run-once dash traversal on two mirrored pathLength-normalized
 * paths built from the card's measured size). Mounted only while the node
 * is active, so each activation restarts the flow; hidden under reduced
 * motion, where the full-strength ring carries the active indication.
 */
function NodeBeam({ nodeId }: { nodeId: string }) {
  const { processMs, processMsByNodeId } = useFlowPlaybackTiming();
  const beamMs = processMsByNodeId?.get(nodeId) ?? processMs;
  const [size, setSize] = useState(BEAM_FALLBACK_SIZE);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        setSize({ width: rect.width, height: rect.height });
      }
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  const style = { stroke: "var(--accent-cyan)", animationDuration: `${beamMs}ms` };
  return (
    <svg
      ref={svgRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible motion-reduce:hidden"
    >
      {(["over", "under"] as const).map((side) => {
        const d = buildBeamPath(size.width, size.height, side);
        return (
          <g key={side}>
            <g opacity={0.35}>
              <path
                className={cn("pipeline-node-beam", `pipeline-node-beam-${side}`)}
                d={d}
                pathLength={1}
                fill="none"
                strokeLinecap="round"
                strokeWidth={7}
                style={style}
              />
            </g>
            <path
              className={cn("pipeline-node-beam", `pipeline-node-beam-${side}`)}
              d={d}
              pathLength={1}
              fill="none"
              strokeLinecap="round"
              strokeWidth={2.5}
              style={style}
            />
          </g>
        );
      })}
    </svg>
  );
}

export function PipelineNode({ id, data, selected }: NodeProps<Node<PipelineNodeData>>) {
  const family = resolveNodeFamily(data.nodeType);
  const familyStyles = getNodeFamilyStyles(family);
  const config = data.config ?? {};
  const configFields = buildPipelineConfigFields(data.configSchema);
  const signature = resolveNodeSignature(data.nodeType, config, configFields);
  const hiddenOverrides = countHiddenOverrides(config, configFields, signature?.consumedKeys ?? []);
  const BackendIcon = signature?.backend ? BACKEND_ICONS[signature.backend] : null;
  const connecting = data.connecting ?? null;
  const hasErrors = (data.errors?.length ?? 0) > 0;
  const active = useFlowNodeActive(id) || Boolean(data.active);
  // A boolean selector, so a node re-renders when the zoom crosses the
  // threshold rather than on every frame of a pinch.
  const showRole = useStore((state) => state.transform[2] >= ROLE_LABEL_MIN_ZOOM);
  const ports = connecting?.from === "source" ? data.inputs : data.outputs;
  const dimWholeNode =
    connecting !== null &&
    connecting.nodeId !== id &&
    !(ports ?? []).some((port) => connecting.valid.has(`${id}.${port.key}`));

  return (
    <div
      className={cn(
        // Geometry (width, padding, the fixed header height below) is what the
        // layout and obstacle router measure — only the material changes here.
        "relative w-[264px] rounded-panel border bg-canvas-raised px-3 pb-2.5 pt-3 text-instrument text-body transition-opacity duration-140 ease-standard",
        familyStyles.border,
        familyStyles.glow,
        selected && "ring-2 ring-accent-violet/70",
        // The beams run on this ring as their track; under reduced motion
        // they are hidden, so the ring returns to full strength as the
        // static active indicator.
        active && "ring-2 ring-accent-cyan/40 motion-reduce:ring-accent-cyan/80",
        data.itemFocus === "traveled" && "border-accent-cyan/70",
        data.itemFocus === "absent" && "opacity-30",
        hasErrors && "border-data-neg/60",
        dimWholeNode && "opacity-40",
      )}
    >
      {selected ? <NodeSelectionToolbar nodeId={id} /> : null}
      {/* Fixed-height header keeps port rows at a predictable offset so the
          obstacle router can connect cards consistently across the graph. */}
      <div className="flex h-[38px] items-start justify-between gap-2 overflow-hidden">
        <div className="min-w-0">
          <p className="truncate text-ui font-medium leading-5 text-primary">{data.label}</p>
          <p className={cn("truncate text-instrument leading-4", familyStyles.badge)}>
            {getNodeFamilyLabel(family)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {hasErrors ? <AlertTriangle className="h-3.5 w-3.5 text-data-neg" /> : null}
          {data.status ? statusBadge(data.status) : null}
        </div>
      </div>

      {data.inputs.length > 0 || data.outputs.length > 0 ? (
        <div className="mt-1.5 grid grid-cols-2 gap-x-3 border-t border-hairline pt-1.5">
          <div>
            {data.inputs.map((port) => (
              <PortRow
                key={`in-${port.key}`}
                port={port}
                side="input"
                connecting={connecting}
                nodeId={id}
                connectable={!data.status}
                showRole={showRole}
              />
            ))}
          </div>
          <div>
            {data.outputs.map((port) => (
              <PortRow
                key={`out-${port.key}`}
                port={port}
                side="output"
                connecting={connecting}
                nodeId={id}
                connectable={!data.status}
                showRole={showRole}
              />
            ))}
          </div>
        </div>
      ) : null}

      {signature ? (
        <div className="mt-2 rounded-control bg-surface px-2.5 py-1.5">
          <p className="text-instrument font-medium leading-4 text-muted">{signature.label}</p>
          <div className="mt-0.5 flex items-center gap-1.5">
            {BackendIcon ? <BackendIcon className="h-3.5 w-3.5 shrink-0" /> : null}
            {/* An index name / model id is a literal: mono, verbatim. */}
            <p
              className={cn(
                "truncate font-mono text-instrument leading-4",
                signature.missing ? "text-meta italic" : familyStyles.badge,
              )}
              title={signature.value}
            >
              {signature.value}
            </p>
          </div>
          {signature.detail ? (
            <p className="truncate text-instrument leading-4 text-meta" title={signature.detail}>
              {signature.detail}
            </p>
          ) : null}
        </div>
      ) : null}

      {hiddenOverrides > 0 ? (
        <p className="mt-1.5 text-instrument leading-4 text-faint">
          · {hiddenOverrides} edited setting{hiddenOverrides === 1 ? "" : "s"}
        </p>
      ) : null}

      {active ? <NodeBeam nodeId={id} /> : null}
    </div>
  );
}

export function DropPreviewNode({ data }: NodeProps<Node<DropPreviewNodeData>>) {
  return (
    <div className="pointer-events-none flex w-[264px] items-center justify-center rounded-panel border border-dashed border-strong bg-canvas-raised/40 px-3 py-8 text-instrument font-medium text-muted">
      {data.label ?? "Drop here"}
    </div>
  );
}

export const pipelineNodeTypes = {
  pipelineNode: PipelineNode,
  dropPreview: DropPreviewNode,
};
