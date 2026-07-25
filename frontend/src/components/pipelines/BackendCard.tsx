"use client";

import { Check } from "lucide-react";

import { PineconeIcon } from "@/components/pipelines/icons/PineconeIcon";
import { PostgresIcon } from "@/components/pipelines/icons/PostgresIcon";
import { cn } from "@/lib/utils";

import type { BackendInfo, IndexBackend } from "@/lib/types";
import type { ReactNode } from "react";

const BACKEND_PRESENTATION: Record<
  IndexBackend,
  { title: string; tagline: string; icon: ReactNode }
> = {
  pgvector: {
    title: "pgvector",
    tagline: "Built-in · PostgreSQL",
    icon: <PostgresIcon className="h-7 w-7" />,
  },
  pinecone: {
    title: "Pinecone",
    tagline: "Managed cloud service",
    icon: <PineconeIcon className="h-7 w-7 text-primary" />,
  },
};

type BackendCardProps = {
  info: BackendInfo;
  selected: boolean;
  onSelect: (backend: IndexBackend) => void;
};

/** One selectable vector-store backend: official logo, name, and whether it's
 * ready to use. Unusable backends (missing API key / extension) render
 * disabled with the reason inline. */
export function BackendCard({ info, selected, onSelect }: BackendCardProps) {
  const presentation = BACKEND_PRESENTATION[info.backend];
  const disabledReason = !info.available
    ? "Unavailable on this deployment."
    : !info.configured
      ? "API key required — add it in Settings."
      : null;
  const disabled = disabledReason !== null;

  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onSelect(info.backend)}
      className={cn(
        "relative flex w-full items-center gap-3 rounded-control border p-3 text-left transition-colors duration-80 ease-standard",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
        selected
          ? "border-accent-violet bg-accent-violet/10 text-primary"
          : "border-hairline bg-surface text-body hover:border-strong",
        disabled && "cursor-not-allowed opacity-50 hover:border-hairline",
      )}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-hairline bg-surface">
        {presentation.icon}
      </span>
      <span className="min-w-0">
        {/* A backend name is a literal the API accepts verbatim. */}
        <span className="flex items-center gap-2 font-mono text-ui text-primary">
          {presentation.title}
          {selected ? <Check aria-hidden className="h-3.5 w-3.5 text-accent-violet" /> : null}
        </span>
        <span className="mt-0.5 block text-instrument text-muted">{presentation.tagline}</span>
        <span
          className={cn(
            "mt-0.5 block text-instrument",
            disabledReason ? "text-data-warn" : "text-meta",
          )}
        >
          {disabledReason ??
            (info.capabilities.requires_api_key ? "Uses your API key" : "No account needed")}
        </span>
      </span>
    </button>
  );
}
