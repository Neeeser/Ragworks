"use client";

import { Handle, Position } from "@xyflow/react";

import { cn } from "@/lib/utils";

import { getNodeFamilyStyles, getPortTypeClasses, resolveNodeFamily } from "./pipeline-theme";

import type { NodeSpec, PipelineRunStatus } from "@/lib/types";
import type { NodeProps } from "@xyflow/react";

export type PipelineNodeExample = {
  input: string;
  output: string;
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
};

const portLeftPercent = (index: number, total: number) => `${((index + 1) / (total + 1)) * 100}%`;

export function PipelineNode({ data }: NodeProps<PipelineNodeData>) {
  const family = resolveNodeFamily(data.nodeType);
  const familyStyles = getNodeFamilyStyles(family);
  return (
    <div
      className={cn(
        "relative min-w-[180px] rounded-2xl border bg-slate-900/90 pl-4 pr-3 py-3 text-xs text-slate-200 shadow-lg",
        familyStyles.border,
        familyStyles.glow,
        data.active && "ring-2 ring-cyan-300/70",
      )}
    >
      <div
        className={cn(
          "absolute left-0 top-3 h-[calc(100%-24px)] w-1 rounded-full",
          familyStyles.accent,
        )}
      />
      {data.inputs.map((port, index) => {
        const portClasses = getPortTypeClasses(port.data_type);
        return (
          <Handle
            key={`input-${port.key}`}
            type="target"
            position={Position.Top}
            id={port.key}
            className={cn(
              "h-2 w-2 rounded-full border",
              portClasses.handle,
              !port.required && "opacity-60",
            )}
            style={{ left: portLeftPercent(index, data.inputs.length) }}
          />
        );
      })}
      {data.outputs.map((port, index) => {
        const portClasses = getPortTypeClasses(port.data_type);
        return (
          <Handle
            key={`output-${port.key}`}
            type="source"
            position={Position.Bottom}
            id={port.key}
            className={cn(
              "h-2 w-2 rounded-full border",
              portClasses.handle,
              !port.required && "opacity-60",
            )}
            style={{ left: portLeftPercent(index, data.outputs.length) }}
          />
        );
      })}
      <div className="flex items-center justify-between">
        <span className="font-semibold text-white">{data.label}</span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-slate-400">
          {data.nodeType}
        </span>
      </div>
      {data.status && (
        <p className="mt-2 text-[10px] uppercase tracking-[0.3em] text-slate-400">{data.status}</p>
      )}
      <div className="mt-2 space-y-1">
        {data.inputs.map((port) => {
          const portClasses = getPortTypeClasses(port.data_type);
          return (
            <div key={port.key} className="flex items-center justify-between text-[10px]">
              <span className="flex items-center gap-2 text-slate-500">
                <span className={cn("h-2 w-2 rounded-full", portClasses.dot)} />
                {port.label}
              </span>
              <span className="text-slate-400">{port.data_type}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 space-y-1">
        {data.outputs.map((port) => {
          const portClasses = getPortTypeClasses(port.data_type);
          return (
            <div key={port.key} className="flex items-center justify-between text-[10px]">
              <span className="flex items-center gap-2 text-slate-500">
                <span className={cn("h-2 w-2 rounded-full", portClasses.dot)} />
                {port.label}
              </span>
              <span className="text-slate-400">{port.data_type}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const pipelineNodeTypes = {
  pipelineNode: PipelineNode,
};
