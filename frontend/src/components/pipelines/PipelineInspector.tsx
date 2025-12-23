"use client";

import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/panel";
import { ParameterFieldCard, ParameterInput } from "@/components/ui/parameter-controls";

import { buildPipelineConfigFields, formatConfigValue } from "./pipeline-config";

import type { PipelineConfigField } from "./pipeline-config";
import type { PipelineNodeData } from "./PipelineNode";
import type { Node } from "@xyflow/react";

type PipelineInspectorProps = {
  selectedNode: Node<PipelineNodeData> | null;
  configDraft: Record<string, unknown>;
  onConfigDraftChange: (value: Record<string, unknown>) => void;
  onLabelChange: (value: string) => void;
  onApplyConfig: () => void;
};

const getInputValue = (field: PipelineConfigField, draft: Record<string, unknown>) => {
  if (Object.prototype.hasOwnProperty.call(draft, field.key)) {
    return draft[field.key];
  }
  return field.defaultValue ?? "";
};

export function PipelineInspector({
  selectedNode,
  configDraft,
  onConfigDraftChange,
  onLabelChange,
  onApplyConfig,
}: PipelineInspectorProps) {
  const fields = selectedNode?.data.configSchema
    ? buildPipelineConfigFields(selectedNode.data.configSchema)
    : [];

  const handleConfigChange = (field: PipelineConfigField, rawValue: string | boolean) => {
    let nextValue: unknown = rawValue;
    if (field.input === "number" || field.input === "integer") {
      if (rawValue === "") {
        nextValue = undefined;
      } else {
        const parsed = Number(rawValue);
        nextValue = Number.isNaN(parsed)
          ? undefined
          : field.input === "integer"
            ? Math.trunc(parsed)
            : parsed;
      }
    } else if (field.input === "boolean") {
      nextValue = rawValue === true;
    } else {
      if (rawValue === "" && field.nullable) {
        nextValue = undefined;
      } else {
        nextValue = rawValue;
      }
    }

    const nextDraft = { ...configDraft };
    if (nextValue === undefined) {
      delete nextDraft[field.key];
    } else {
      nextDraft[field.key] = nextValue;
    }
    onConfigDraftChange(nextDraft);
  };

  return (
    <GlassCard className="rounded-3xl p-5">
      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Inspector</p>
      {selectedNode ? (
        <div className="mt-4 space-y-3 text-sm">
          <div>
            <p className="text-xs text-slate-400">Node label</p>
            <input
              className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-400"
              value={selectedNode.data.label}
              onChange={(event) => onLabelChange(event.target.value)}
            />
          </div>
          <div>
            <p className="text-xs text-slate-400">Node type</p>
            <p className="text-sm text-white">{selectedNode.data.nodeType}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Description</p>
            <p className="text-sm text-slate-200">
              {selectedNode.data.description || "No description available."}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Example</p>
            {selectedNode.data.example ? (
              <div className="mt-2 flex flex-col items-center gap-2 md:flex-row">
                <div className="w-full rounded-2xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-sky-200/70">Input</p>
                  <pre className="mt-1 whitespace-pre-wrap font-sans">
                    {selectedNode.data.example.input}
                  </pre>
                </div>
                <ArrowRight className="h-4 w-4 rotate-90 text-slate-400 md:rotate-0" />
                <div className="w-full rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-emerald-200/70">
                    Output
                  </p>
                  <pre className="mt-1 whitespace-pre-wrap font-sans">
                    {selectedNode.data.example.output}
                  </pre>
                </div>
              </div>
            ) : (
              <p className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200">
                No example available.
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-slate-400">Config</p>
            {fields.length > 0 ? (
              <div className="mt-2 space-y-3">
                {fields.map((field) => {
                  const value = getInputValue(field, configDraft);
                  const helper =
                    field.defaultValue !== undefined
                      ? `Default: ${formatConfigValue(field.defaultValue)}`
                      : field.required
                        ? "Required"
                        : undefined;

                  return (
                    <ParameterFieldCard
                      key={field.key}
                      label={field.label}
                      description={field.description}
                      helper={helper}
                    >
                      <ParameterInput
                        input={field.input}
                        value={value}
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        placeholder={field.placeholder}
                        options={field.options}
                        onChange={(nextValue) => handleConfigChange(field, nextValue)}
                      />
                    </ParameterFieldCard>
                  );
                })}
              </div>
            ) : (
              <p className="mt-1 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200">
                This node has no configurable settings.
              </p>
            )}
          </div>
          <Button variant="secondary" onClick={onApplyConfig}>
            Apply config
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-400">
          Select a node to inspect or tweak configuration.
        </p>
      )}
    </GlassCard>
  );
}
