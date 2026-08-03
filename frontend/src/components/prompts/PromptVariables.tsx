"use client";

import { Plus } from "lucide-react";

import { TextInput } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";

import type { PromptCatalog } from "@/lib/types";

interface PromptVariablesProps {
  catalog: PromptCatalog | null;
  /** Sample value per variable — what the preview and test bench render. */
  values: Record<string, string>;
  onValueChange: (name: string, value: string) => void;
  onInsert: (name: string) => void;
}

/**
 * The context's variables with their sample values.
 *
 * The sample value is the whole point of this block: it is what the
 * `values` view renders inside the template and what a test run actually
 * sends, so tuning a prompt for a real corpus means typing a real query
 * here rather than reading the catalog's stock example.
 */
export function PromptVariables({
  catalog,
  values,
  onValueChange,
  onInsert,
}: PromptVariablesProps) {
  const variables = catalog?.variables ?? [];
  const namespaces = catalog?.namespaces ?? [];

  return (
    <div className="shrink-0 space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-instrument font-medium text-muted">Variables</span>
        <span className="text-instrument text-meta">
          Sample values feed the preview and test runs
        </span>
      </div>
      <div className="divide-y divide-hairline rounded-control border border-hairline">
        {variables.map((variable) => (
          <div key={variable.name} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
            <Tooltip content={`Insert {{${variable.name}}} at the cursor`}>
              <button
                type="button"
                onClick={() => onInsert(variable.name)}
                aria-label={`Insert ${variable.name}`}
                className="flex shrink-0 items-center gap-1 rounded-chip border border-hairline px-1.5 py-0.5 font-mono text-instrument text-accent-violet transition-colors duration-80 ease-standard hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
              >
                <Plus className="h-2.5 w-2.5" aria-hidden />
                {`{{${variable.name}}}`}
              </button>
            </Tooltip>
            <p className="min-w-32 flex-1 text-ui text-body">{variable.description}</p>
            <div className="w-full sm:w-64">
              <TextInput
                aria-label={`Sample value for ${variable.name}`}
                placeholder={variable.example ?? "Sample value"}
                value={values[variable.name] ?? ""}
                onChange={(event) => onValueChange(variable.name, event.target.value)}
              />
            </div>
          </div>
        ))}
        {namespaces.map((namespace) => (
          <div key={namespace.prefix} className="px-2 py-1.5">
            <code className="font-mono text-instrument text-accent-violet">
              {`{{${namespace.prefix}.<key>}}`}
            </code>
            <p className="mt-0.5 text-ui text-body">{namespace.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
