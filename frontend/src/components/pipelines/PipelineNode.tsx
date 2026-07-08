"use client";

import { Handle, Position } from "@xyflow/react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";

import { cn, truncate } from "@/lib/utils";

import { buildPipelineConfigFields, formatConfigValue } from "./lib/pipeline-config";
import {
  getNodeFamilyLabel,
  getNodeFamilyStyles,
  getPortTypeClasses,
  getPortTypeLabel,
  resolveNodeFamily,
} from "./lib/pipeline-theme";

import type { NodeSpec, PipelineRunStatus } from "@/lib/types";
import type { Node, NodeProps } from "@xyflow/react";

export type PipelineNodeExample = {
  input: string;
  output: string;
};

export type DropPreviewNodeData = {
  label?: string;
};

/** Live connection-drag context injected into every node while a wire is dragged. */
export type ConnectingContext = {
  /** Data type flowing from the picked-up handle. */
  dataType: string;
  /** Which side was picked up: a source handle looks for targets, and vice versa. */
  from: "source" | "target";
  nodeId: string;
};

export type PipelineNodeData = {
  label: string;
  nodeType: string;
  description?: string;
  example?: PipelineNodeExample;
  inputs: NodeSpec["input_ports"];
  outputs: NodeSpec["output_ports"];
  config: Record<string, unknown>;
  configSchema?: Record<string, unknown>;
  status?: PipelineRunStatus;
  active?: boolean;
  connecting?: ConnectingContext | null;
  errors?: string[];
};

const CONFIG_PREVIEW_LIMIT = 40;
const CONFIG_ROW_LIMIT = 5;

const statusBadge = (status: PipelineRunStatus) => {
  if (status === "completed") {
    return (
      <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-300">
        <Check className="h-3 w-3" /> done
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex items-center gap-1 text-[10px] font-medium text-rose-300">
        <AlertTriangle className="h-3 w-3" /> failed
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] font-medium text-cyan-300">
      <Loader2 className="h-3 w-3 animate-spin" /> running
    </span>
  );
};

type PortRowProps = {
  portKey: string;
  label: string;
  dataType: string;
  required: boolean;
  side: "input" | "output";
  connecting?: ConnectingContext | null;
  nodeId: string;
  connectable: boolean;
};

/**
 * One port row: label + typed color dot, with its xyflow Handle anchored on the
 * card edge at the row's height. While a wire is dragged, compatible handles
 * swell and pulse; incompatible ones fade so valid drop targets are obvious.
 */
function PortRow({
  portKey,
  label,
  dataType,
  required,
  side,
  connecting,
  nodeId,
  connectable,
}: PortRowProps) {
  const portClasses = getPortTypeClasses(dataType);
  const isTargetSide = side === "input";
  const wanted =
    connecting &&
    connecting.nodeId !== nodeId &&
    ((connecting.from === "source" && isTargetSide) ||
      (connecting.from === "target" && !isTargetSide));
  const compatible = wanted && connecting.dataType === dataType;
  const incompatible = Boolean(connecting) && !compatible;

  return (
    <div
      className={cn(
        "relative flex items-center gap-1.5 py-0.5 text-[10px] leading-4",
        isTargetSide ? "justify-start" : "justify-end",
        incompatible && "opacity-40",
      )}
    >
      {isTargetSide ? (
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", portClasses.dot)} />
      ) : null}
      <span className="truncate text-slate-400" title={`${label} · ${getPortTypeLabel(dataType)}`}>
        {label}
        {!required && isTargetSide ? <span className="text-slate-600"> (optional)</span> : null}
      </span>
      {!isTargetSide ? (
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", portClasses.dot)} />
      ) : null}
      <Handle
        type={isTargetSide ? "target" : "source"}
        position={isTargetSide ? Position.Left : Position.Right}
        id={portKey}
        isConnectable={connectable}
        className={cn(
          "!absolute !top-1/2 !h-3 !w-3 !-translate-y-1/2 !rounded-full !border-2 !border-slate-950 !transition-all",
          portClasses.handle,
          isTargetSide ? "!-left-[19px]" : "!-right-[19px]",
          compatible && "!h-4 !w-4 animate-pulse !ring-2 !ring-white/70",
          incompatible && "!opacity-30",
        )}
      />
    </div>
  );
}

export function PipelineNode({ id, data, selected }: NodeProps<Node<PipelineNodeData>>) {
  const family = resolveNodeFamily(data.nodeType);
  const familyStyles = getNodeFamilyStyles(family);
  const configEntries = Object.entries(data.config ?? {});
  const displayedEntries =
    configEntries.length > 0
      ? configEntries
      : buildPipelineConfigFields(data.configSchema).flatMap((field) =>
          field.defaultValue === undefined ? [] : [[field.key, field.defaultValue] as const],
        );
  const connecting = data.connecting ?? null;
  const hasErrors = (data.errors?.length ?? 0) > 0;
  const dimWholeNode =
    connecting !== null &&
    connecting.nodeId !== id &&
    !(connecting.from === "source"
      ? data.inputs.some((port) => port.data_type === connecting.dataType)
      : data.outputs.some((port) => port.data_type === connecting.dataType));

  return (
    <div
      className={cn(
        "relative w-[264px] rounded-2xl border bg-slate-900/95 px-3 pb-2.5 pt-3 text-xs text-slate-200 shadow-lg transition-opacity duration-150",
        familyStyles.border,
        familyStyles.glow,
        selected && "ring-2 ring-violet-400/70",
        data.active && "ring-2 ring-cyan-300/80 shadow-[0_0_32px_rgba(103,232,249,0.25)]",
        hasErrors && "border-rose-400/60",
        dimWholeNode && "opacity-40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-white">{data.label}</p>
          <p className={cn("text-[10px] uppercase tracking-[0.2em]", familyStyles.badge)}>
            {getNodeFamilyLabel(family)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {hasErrors ? <AlertTriangle className="h-3.5 w-3.5 text-rose-300" /> : null}
          {data.status ? statusBadge(data.status) : null}
        </div>
      </div>

      {displayedEntries.length > 0 ? (
        <div className="mt-2 space-y-0.5 rounded-xl bg-white/[0.04] px-2 py-1.5">
          {displayedEntries.slice(0, CONFIG_ROW_LIMIT).map(([key, value]) => (
            <div
              key={key}
              className="flex items-center justify-between gap-2 text-[10px] leading-4"
            >
              <span className="truncate text-slate-500">{key}</span>
              <span className="max-w-[130px] truncate text-slate-300">
                {truncate(formatConfigValue(value), CONFIG_PREVIEW_LIMIT)}
              </span>
            </div>
          ))}
          {displayedEntries.length > CONFIG_ROW_LIMIT ? (
            <p className="text-[10px] text-slate-600">
              +{displayedEntries.length - CONFIG_ROW_LIMIT} more
            </p>
          ) : null}
        </div>
      ) : null}

      {data.inputs.length > 0 || data.outputs.length > 0 ? (
        <div className="mt-2 grid grid-cols-2 gap-x-3 border-t border-white/5 pt-1.5">
          <div>
            {data.inputs.map((port) => (
              <PortRow
                key={`in-${port.key}`}
                portKey={port.key}
                label={port.label}
                dataType={port.data_type}
                required={port.required}
                side="input"
                connecting={connecting}
                nodeId={id}
                connectable={!data.status}
              />
            ))}
          </div>
          <div>
            {data.outputs.map((port) => (
              <PortRow
                key={`out-${port.key}`}
                portKey={port.key}
                label={port.label}
                dataType={port.data_type}
                required={port.required}
                side="output"
                connecting={connecting}
                nodeId={id}
                connectable={!data.status}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DropPreviewNode({ data }: NodeProps<Node<DropPreviewNodeData>>) {
  return (
    <div className="pointer-events-none flex w-[264px] items-center justify-center rounded-2xl border border-dashed border-slate-400/60 bg-slate-900/40 px-3 py-8 text-xs uppercase tracking-[0.3em] text-slate-300">
      {data.label ?? "Drop here"}
    </div>
  );
}

export const pipelineNodeTypes = {
  pipelineNode: PipelineNode,
  dropPreview: DropPreviewNode,
};
