"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

import { Tooltip } from "../ui/tooltip";

import { IndexBackendIcon } from "./icons/IndexBackendIcon";
import { backendSupportLabel, restrictedBackends } from "./lib/backend-support";
import { getNodeFamilyStyles, type NodeFamily } from "./lib/pipeline-theme";
import { NODE_PRESET_MIME, presetizedSpec } from "./lib/presets";

import type { IndexBackend, NodePreset, NodeSpec } from "@/lib/types";
import type { DragEvent } from "react";

export const NODE_DRAG_TYPE = "application/ragworks-node";

type NodeLibraryRowProps = {
  spec: NodeSpec;
  family: NodeFamily;
  unavailable: boolean;
  unavailableMessage?: string | null;
  knownBackends: IndexBackend[];
  onPreviewNode: (spec: NodeSpec) => void;
};

/** Stamp the shared node drag payload (plus the preset id when one rides along). */
export const setNodeDragData = (
  event: DragEvent<HTMLButtonElement>,
  spec: NodeSpec,
  preset?: NodePreset,
) => {
  event.dataTransfer.setData(NODE_DRAG_TYPE, spec.type);
  if (preset) {
    event.dataTransfer.setData(NODE_PRESET_MIME, preset.id);
  }
  event.dataTransfer.effectAllowed = "move";
};

/**
 * One node in the library panel: stage dot + label, draggable onto the canvas,
 * click for the preview drawer. Backend-restricted nodes keep their store
 * icons (informational — validation is the hard gate); presets nest indented
 * under their shell with a count pill on the shell row.
 */
export function NodeLibraryRow({
  spec,
  family,
  unavailable,
  unavailableMessage,
  knownBackends,
  onPreviewNode,
}: NodeLibraryRowProps) {
  const styles = getNodeFamilyStyles(family);
  const restricted = restrictedBackends(spec, knownBackends);
  const presets = spec.presets ?? [];

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, preset?: NodePreset) => {
    if (unavailable) {
      event.preventDefault();
      return;
    }
    setNodeDragData(event, spec, preset);
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => onPreviewNode(spec)}
        onDragStart={(event) => handleDragStart(event)}
        draggable={!unavailable}
        disabled={unavailable}
        className="group flex w-full items-center gap-2 rounded-control border border-hairline bg-surface px-2 py-1.5 text-left transition-colors duration-80 ease-standard hover:border-strong hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset disabled:cursor-not-allowed disabled:hover:border-hairline disabled:hover:bg-surface"
      >
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-[2px]",
            styles.accent,
            unavailable && "opacity-40",
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-ui font-medium",
            unavailable ? "text-faint" : "text-primary",
          )}
        >
          {spec.label}
        </span>
        {presets.length > 0 ? (
          <span className="shrink-0 rounded-full border border-hairline px-1.5 text-instrument text-meta">
            {presets.length}
          </span>
        ) : null}
        {restricted ? (
          // One backend logo per store the node works with; a single tooltip
          // carries the "only available on" detail so the row stays uncluttered
          // and new backends just add another icon.
          <Tooltip
            content={`Only available on ${backendSupportLabel(restricted)}`}
            side="left"
            triggerClassName="shrink-0 items-center gap-1"
          >
            {restricted.map((backend) => (
              <IndexBackendIcon key={backend} backend={backend} className="h-3.5 w-3.5 shrink-0" />
            ))}
          </Tooltip>
        ) : null}
      </button>
      {presets.length > 0 ? (
        <div
          className="mb-1 mt-1 space-y-1 border-l-2 border-hairline pl-2"
          style={{ marginLeft: 10 }}
        >
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              draggable={!unavailable}
              onClick={() => onPreviewNode(presetizedSpec(spec, preset))}
              onDragStart={(event) => handleDragStart(event, preset)}
              className="flex w-full items-center gap-2 rounded-control px-2 py-1 text-left transition-colors duration-80 ease-standard hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset"
            >
              <span
                aria-hidden
                className={cn("h-1.5 w-1.5 shrink-0 rounded-[2px] opacity-50", styles.accent)}
              />
              <span className="min-w-0 flex-1 truncate text-instrument font-medium text-body">
                {preset.label}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {unavailable && unavailableMessage ? (
        <p className="mt-1 px-1 text-instrument text-muted">
          {unavailableMessage}{" "}
          <Link
            href="/settings"
            className="rounded-control text-accent-cyan underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
          >
            Settings
          </Link>
        </p>
      ) : null}
    </div>
  );
}
