"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { PipelineMiniMap } from "@/components/collections/detail/overview/PipelineMiniMap";
import {
  getNodeFamilyColorVar,
  resolveNodeFamily,
} from "@/components/pipelines/lib/pipeline-theme";
import { cn } from "@/lib/utils";

import type { Pipeline } from "@/lib/types";
import type { KeyboardEvent } from "react";

type PipelineSelectProps = {
  label: string;
  pipelines: Pipeline[];
  value: string;
  onChange: (pipelineId: string) => void;
};

function PreviewPane({ pipeline }: { pipeline: Pipeline }) {
  const stages = pipeline.definition.nodes.slice(0, 6);
  const overflow = pipeline.definition.nodes.length - stages.length;
  return (
    <div className="hidden w-60 shrink-0 border-l border-hairline p-3 sm:block">
      <p className="truncate text-sm font-medium text-primary">{pipeline.name}</p>
      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-meta">
        {pipeline.definition.nodes.length} nodes · v{pipeline.current_version}
      </p>
      <PipelineMiniMap definition={pipeline.definition} className="mt-3 h-24 w-full" />
      <ul className="mt-2 space-y-1">
        {stages.map((node) => (
          <li key={node.id} className="flex items-center gap-2 text-xs text-body">
            <span
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: getNodeFamilyColorVar(resolveNodeFamily(node.type)) }}
              aria-hidden
            />
            <span className="truncate">{node.name}</span>
          </li>
        ))}
        {overflow > 0 && <li className="text-xs text-meta">+{overflow} more</li>}
      </ul>
    </div>
  );
}

/**
 * A pipeline picker that replaces the native select: a listbox of the
 * collection's pipelines with a live mini-map preview of whichever option
 * is hovered or focused.
 */
export function PipelineSelect({ label, pipelines, value, onChange }: PipelineSelectProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const selected = pipelines.find((pipeline) => pipeline.id === value) ?? null;
  const previewed = pipelines.find((pipeline) => pipeline.id === (previewId ?? value)) ?? null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown, true);
    return () => document.removeEventListener("mousedown", onPointerDown, true);
  }, [open]);

  const openList = () => {
    setPreviewId(null);
    setOpen(true);
  };

  const choose = (pipelineId: string) => {
    onChange(pipelineId);
    setOpen(false);
  };

  const moveFocus = (direction: 1 | -1) => {
    const options = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? [],
    );
    if (options.length === 0) return;
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = current === -1 ? 0 : (current + direction + options.length) % options.length;
    options[next].focus();
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openList())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        className={cn(
          "flex w-full items-center justify-between gap-3 rounded-2xl border border-hairline bg-surface px-4 py-2.5",
          "text-left text-sm text-primary transition hover:border-strong",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
          "focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        )}
      >
        <span className="truncate">{selected?.name ?? "Select a pipeline"}</span>
        <span className="flex items-center gap-2">
          {selected?.is_default && (
            <span className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-meta">
              Default
            </span>
          )}
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-muted transition", open && "rotate-180")}
            aria-hidden
          />
        </span>
      </button>

      {open && (
        <div
          onKeyDown={onListKeyDown}
          className="absolute left-0 right-0 top-full z-30 mt-2 flex overflow-hidden rounded-2xl border border-hairline bg-canvas-raised shadow-elevation-2"
        >
          <ul
            id={listboxId}
            role="listbox"
            aria-label={label}
            className="max-h-64 min-w-0 flex-1 overflow-y-auto p-1.5"
          >
            {pipelines.map((pipeline) => (
              <li key={pipeline.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={pipeline.id === value}
                  onClick={() => choose(pipeline.id)}
                  onMouseEnter={() => setPreviewId(pipeline.id)}
                  onFocus={() => setPreviewId(pipeline.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
                    pipeline.id === value ? "text-primary" : "text-body hover:bg-surface",
                  )}
                >
                  <Check
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      pipeline.id === value ? "text-accent-violet" : "invisible",
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{pipeline.name}</span>
                  {pipeline.is_default && (
                    <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.2em] text-meta">
                      Default
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {previewed && <PreviewPane pipeline={previewed} />}
        </div>
      )}
    </div>
  );
}
