"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Readout } from "@/components/ui/readout";
import { cn } from "@/lib/utils";

const stringifyData = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export const truncateText = (value: string, limit = 360): string => {
  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, limit)}…`;
};

export const formatToolLabel = (label: string): string => {
  if (!label) return "Tool";
  const friendly = label
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
  return friendly || "Tool";
};

const formatKeyLabel = (key: string): string => {
  return key
    .split(/[\s._-]+/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
};

/** A raw payload, verbatim, scrolling inside its own box. */
export const JsonBlock = ({
  data,
  className,
  maxHeight = 240,
}: {
  data: unknown;
  className?: string;
  maxHeight?: number;
}) => (
  <pre
    style={{ maxHeight }}
    className={cn(
      "overflow-auto whitespace-pre-wrap break-words rounded-control border border-hairline bg-surface-strong p-2 font-mono text-instrument text-body",
      className,
    )}
  >
    {stringifyData(data)}
  </pre>
);

interface ToolValueProps {
  value: unknown;
}

export const ToolValue = ({ value }: ToolValueProps) => {
  if (value === null || value === undefined) {
    return <span className="text-muted">N/A</span>;
  }
  if (typeof value === "string") {
    return <span className="text-ui text-primary">{value}</span>;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <span className="font-mono text-ui tabular-nums text-primary">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    const primitiveItems = value.every(
      (item) =>
        item === null ||
        item === undefined ||
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean",
    );
    if (primitiveItems) {
      return (
        <ul className="list-disc space-y-1 pl-4 text-ui text-body">
          {value.map((item, index) => (
            <li key={`tool-value-${index}`}>{String(item ?? "N/A")}</li>
          ))}
        </ul>
      );
    }
    return <JsonBlock data={value} />;
  }
  if (typeof value === "object") {
    return <JsonBlock data={value} />;
  }
  return <span className="text-ui text-primary">{String(value)}</span>;
};

interface ToolKeyValueGridProps {
  data: Record<string, unknown>;
  emptyLabel?: string;
}

export const ToolKeyValueGrid = ({
  data,
  emptyLabel = "No data available.",
}: ToolKeyValueGridProps) => {
  const entries = Object.entries(data).filter((entry) => {
    const value = entry[1];
    if (value === null || value === undefined) {
      return false;
    }
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    return true;
  });

  if (entries.length === 0) {
    return <p className="text-ui text-muted">{emptyLabel}</p>;
  }

  return (
    <dl className="grid gap-x-4 gap-y-2 text-left sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="min-w-0">
          <dt>
            <InstrumentLabel>{formatKeyLabel(key)}</InstrumentLabel>
          </dt>
          <dd className="mt-0.5 min-w-0 break-words">
            <ToolValue value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
};

interface ToolPayloadSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}

/** One labelled block of a tool call's payload, optionally collapsed. */
export const ToolPayloadSection = ({
  title,
  description,
  children,
  collapsible = false,
  defaultOpen = true,
}: ToolPayloadSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);

  const header = (
    <>
      <InstrumentLabel className="text-body">{title}</InstrumentLabel>
      {description && <p className="text-instrument text-meta">{description}</p>}
    </>
  );

  if (!collapsible) {
    return (
      <section className="space-y-2 border-t border-hairline pt-3 first:border-t-0 first:pt-0">
        <header>{header}</header>
        {children}
      </section>
    );
  }

  return (
    <section className="space-y-2 border-t border-hairline pt-3 first:border-t-0 first:pt-0">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-2 rounded-control text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span className="min-w-0">{header}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-140 ease-standard",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <div>{children}</div>}
    </section>
  );
};

interface ToolChunkListProps {
  chunks: unknown[];
  onSelectChunk?: (chunkId: string) => void;
}

/** The chunks a retrieval tool returned, each with the record it came from. */
export const ToolChunkList = ({ chunks, onSelectChunk }: ToolChunkListProps) => {
  const normalized = chunks
    .map((chunk) =>
      chunk && typeof chunk === "object" ? (chunk as Record<string, unknown>) : null,
    )
    .filter(Boolean) as Record<string, unknown>[];

  if (normalized.length === 0) {
    return <p className="text-ui text-muted">No chunk data returned.</p>;
  }

  return (
    <div className="divide-y divide-hairline">
      {normalized.map((chunk, index) => {
        const chunkId = (chunk.chunk_id as string) || (chunk.id as string) || `chunk-${index + 1}`;
        const documentId = (chunk.document_id as string) ?? chunk.documentId;
        const order = typeof chunk.order === "number" ? chunk.order : null;
        const score =
          typeof chunk.score === "number"
            ? chunk.score
            : typeof chunk.score === "string"
              ? Number(chunk.score)
              : null;
        const textValue = typeof chunk.text === "string" ? chunk.text : null;
        const metadata =
          chunk.metadata && typeof chunk.metadata === "object"
            ? (chunk.metadata as Record<string, unknown>)
            : null;

        return (
          <article key={`${chunkId}-${index}`} className="space-y-2 py-2 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <Readout label="Chunk">{index + 1}</Readout>
              {Number.isFinite(score) && (
                <Readout label="Score">{Number(score).toFixed(3)}</Readout>
              )}
              {onSelectChunk && chunkId && (
                <button
                  type="button"
                  onClick={() => onSelectChunk(chunkId)}
                  className="ml-auto rounded-control px-1.5 py-0.5 text-instrument font-medium text-accent-cyan transition-colors duration-80 ease-standard hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
                >
                  Trace chunk
                </button>
              )}
            </div>
            {textValue && (
              <p className="max-w-[66ch] text-ui leading-relaxed text-body">
                {truncateText(textValue)}
              </p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {documentId && <Readout label="Document">{documentId}</Readout>}
              {chunkId && (
                <Readout label="Chunk id" className="min-w-0">
                  {chunkId}
                </Readout>
              )}
              {Number.isFinite(order) && <Readout label="Order">{order}</Readout>}
            </div>
            {metadata && Object.keys(metadata).length > 0 && (
              <div>
                <InstrumentLabel>Metadata</InstrumentLabel>
                <JsonBlock data={metadata} maxHeight={180} className="mt-1" />
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
};
