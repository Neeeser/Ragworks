"use client";

import { Readout } from "@/components/ui/readout";

import type { TraceValueViewProps } from "@/components/traces/values/TraceValueViews";

/** The `llm_call` summary an LLM node attaches: model, mechanism, prompts. */
export interface LlmCallTrace {
  model_name: string;
  mechanism: string | null;
  temperature?: number;
  system_prompt?: string;
  prompt?: string;
  output_fields?: Array<{ name: string; type: string; target: string }>;
  retries?: number;
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

export const isLlmCallTrace = (value: unknown): value is LlmCallTrace =>
  typeof value === "object" &&
  value !== null &&
  "model_name" in value &&
  "mechanism" in value &&
  "prompt" in value;

/** LLM node call summary: identity readouts, then the prompt templates. */
export function LlmCallValue({ value }: TraceValueViewProps) {
  const call = value as LlmCallTrace;
  const fields = call.output_fields ?? [];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Readout label="model">{call.model_name || "—"}</Readout>
        <Readout label="mechanism">{call.mechanism ?? "—"}</Readout>
        {typeof call.retries === "number" && call.retries > 0 ? (
          <Readout label="retries">{call.retries}</Readout>
        ) : null}
        {typeof call.usage?.total_tokens === "number" ? (
          <Readout label="tokens">{call.usage.total_tokens.toLocaleString()}</Readout>
        ) : null}
      </div>
      {fields.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {fields.map((field) => (
            <span
              key={field.name}
              className="rounded-chip border border-hairline bg-surface px-1.5 py-0.5 font-mono text-instrument text-body"
            >
              {field.name}: {field.type} → {field.target}
            </span>
          ))}
        </div>
      ) : null}
      {call.system_prompt ? (
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-panel border border-hairline bg-canvas p-3 font-mono text-instrument leading-relaxed text-muted">
          {call.system_prompt}
        </pre>
      ) : null}
      {call.prompt ? (
        <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-panel border border-hairline bg-canvas p-3 font-mono text-instrument leading-relaxed text-body">
          {call.prompt}
        </pre>
      ) : null}
    </div>
  );
}
