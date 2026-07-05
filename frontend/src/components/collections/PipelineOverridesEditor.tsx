"use client";

import { useMemo } from "react";

import { ParameterFieldCard, ParameterInput } from "@/components/ui/parameter-controls";

import {
  buildPipelineConfigFields,
  coerceFieldValue,
  formatConfigValue,
  getInputValue,
} from "../pipelines/pipeline-config";

import type { PipelineConfigField } from "../pipelines/pipeline-config";
import type { NodeSpec, Pipeline } from "@/lib/types";

type OverridesState = Record<string, Record<string, unknown>>;

type PipelineOverridesEditorProps = {
  title: string;
  pipeline: Pipeline | null;
  nodeSpecs: NodeSpec[];
  overrides: OverridesState;
  onOverridesChange: (next: OverridesState) => void;
};

export function PipelineOverridesEditor({
  title,
  pipeline,
  nodeSpecs,
  overrides,
  onOverridesChange,
}: PipelineOverridesEditorProps) {
  const specsByType = useMemo(
    () => new Map(nodeSpecs.map((spec) => [spec.type, spec])),
    [nodeSpecs],
  );

  if (!pipeline) {
    return <p className="text-sm text-slate-400">Select a pipeline to configure overrides.</p>;
  }

  const handleConfigChange = (
    nodeId: string,
    field: PipelineConfigField,
    rawValue: string | boolean,
  ) => {
    const nextValue = coerceFieldValue(field, rawValue);

    const nextOverrides = { ...overrides };
    const nextConfig = { ...(nextOverrides[nodeId] ?? {}) };
    if (nextValue === undefined) {
      delete nextConfig[field.key];
    } else {
      nextConfig[field.key] = nextValue;
    }
    nextOverrides[nodeId] = nextConfig;
    onOverridesChange(nextOverrides);
  };

  return (
    <div className="space-y-4">
      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{title}</p>
      <div className="space-y-4">
        {pipeline.definition.nodes.map((node) => {
          const spec = specsByType.get(node.type);
          const schema = spec?.config_schema;
          const fields = schema ? buildPipelineConfigFields(schema) : [];
          if (fields.length === 0) {
            return null;
          }

          const baseConfig = {
            ...(spec?.default_config ?? {}),
            ...(node.config ?? {}),
          };
          const draftConfig = overrides[node.id] ?? baseConfig;

          return (
            <div key={node.id} className="space-y-3 rounded-3xl border border-white/10 p-4">
              <div>
                <p className="text-sm font-semibold text-white">{node.name}</p>
                <p className="text-xs text-slate-400">{node.type}</p>
              </div>
              <div className="space-y-3">
                {fields.map((field) => {
                  const value = getInputValue(field, draftConfig);
                  const helper =
                    field.defaultValue !== undefined
                      ? `Default: ${formatConfigValue(field.defaultValue)}`
                      : field.required
                        ? "Required"
                        : undefined;

                  return (
                    <ParameterFieldCard
                      key={`${node.id}-${field.key}`}
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
                        onChange={(nextValue) => handleConfigChange(node.id, field, nextValue)}
                      />
                    </ParameterFieldCard>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
