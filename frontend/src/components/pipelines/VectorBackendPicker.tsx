"use client";

import { InstrumentLabel } from "@/components/ui/instrument-label";

import { IndexBackendIcon } from "./icons/IndexBackendIcon";

import type { IndexBackend } from "@/lib/types";

const BACKEND_OPTIONS: Array<{ value: IndexBackend; label: string; hint: string }> = [
  { value: "pgvector", label: "pgvector", hint: "Built-in Postgres" },
  { value: "pinecone", label: "Pinecone", hint: "Managed cloud" },
];

type VectorBackendPickerProps = {
  backend: IndexBackend;
  onChange: (backend: IndexBackend) => void;
  disabled: boolean;
};

/** Which vector store a store-bound node targets, as a two-option radiogroup. */
export function VectorBackendPicker({ backend, onChange, disabled }: VectorBackendPickerProps) {
  return (
    <div>
      <InstrumentLabel>Vector store</InstrumentLabel>
      <div
        className="mt-2 grid grid-cols-2 gap-2"
        role="radiogroup"
        aria-label="Vector store backend"
      >
        {BACKEND_OPTIONS.map((option) => {
          const active = option.value === backend;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`flex items-center gap-2 rounded-control border px-2 py-2 text-left transition-colors duration-80 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet ${
                active
                  ? "border-accent-violet/70 bg-accent-violet/10 text-primary"
                  : "border-hairline bg-surface text-body hover:border-strong"
              }`}
            >
              <IndexBackendIcon backend={option.value} />
              <span className="min-w-0">
                {/* The backend name is a literal (`pgvector`), so it stays
                    verbatim; the hint beside it is a label. */}
                <span className="block truncate font-mono text-ui">{option.label}</span>
                <span className="block truncate text-instrument text-meta">{option.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
