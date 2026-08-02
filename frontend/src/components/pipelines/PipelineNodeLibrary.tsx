"use client";

import Link from "next/link";

import { InstrumentLabel } from "../ui/instrument-label";
import { Tooltip } from "../ui/tooltip";

import { IndexBackendIcon } from "./icons/IndexBackendIcon";
import { backendSupportLabel, restrictedBackends } from "./lib/backend-support";
import { getNodeFamilyLabel, getNodeFamilyStyles, type NodeFamily } from "./lib/pipeline-theme";
import { NODE_PRESET_MIME, presetizedSpec } from "./lib/presets";
import { RERANKER_NODE_TYPE, RERANKER_PROVIDER_REQUIRED } from "./lib/reranking";

import type { IndexBackend, NodePreset, NodeSpec } from "@/lib/types";
import type { DragEvent } from "react";

type PipelineNodeLibraryProps = {
  catalog: Array<{ family: NodeFamily; specs: NodeSpec[] }>;
  onPreviewNode: (spec: NodeSpec) => void;
  hasRerankingProvider?: boolean;
  rerankingProviderMessage?: string | null;
  /** Backends this deployment knows about; used to flag backend-restricted nodes. */
  knownBackends?: IndexBackend[];
};

const NODE_DRAG_TYPE = "application/ragworks-node";

export function PipelineNodeLibrary({
  catalog,
  onPreviewNode,
  hasRerankingProvider = true,
  rerankingProviderMessage = RERANKER_PROVIDER_REQUIRED,
  knownBackends = [],
}: PipelineNodeLibraryProps) {
  const handleDragStart = (
    event: DragEvent<HTMLButtonElement>,
    spec: NodeSpec,
    preset?: NodePreset,
  ) => {
    if (spec.type === RERANKER_NODE_TYPE && !hasRerankingProvider) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData(NODE_DRAG_TYPE, spec.type);
    if (preset) {
      event.dataTransfer.setData(NODE_PRESET_MIME, preset.id);
    }
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="border-t border-hairline p-2">
      <div className="flex items-baseline justify-between gap-2 px-1 py-1">
        <InstrumentLabel className="text-body">Node library</InstrumentLabel>
        {/* Kept: drag-to-add is the only affordance the layout cannot show. */}
        <InstrumentLabel>Drag onto the canvas</InstrumentLabel>
      </div>
      <div className="mt-1 space-y-3">
        {catalog.map(({ family, specs }) => {
          const styles = getNodeFamilyStyles(family);
          return (
            <div key={family}>
              <InstrumentLabel className={`px-1 ${styles.badge}`}>
                {getNodeFamilyLabel(family)}
              </InstrumentLabel>
              <div className="mt-1 space-y-1">
                {specs.map((spec) => {
                  const unavailable = spec.type === RERANKER_NODE_TYPE && !hasRerankingProvider;
                  // Restriction is informational: a store-bound node still
                  // drags onto the canvas so a user can build a pipeline for
                  // a backend they haven't selected yet — validation is the
                  // hard gate. The badge just sets expectations up front.
                  const restricted = restrictedBackends(spec, knownBackends);
                  return (
                    <div key={spec.type}>
                      <button
                        type="button"
                        onClick={() => onPreviewNode(spec)}
                        onDragStart={(event) => handleDragStart(event, spec)}
                        draggable={!unavailable}
                        disabled={unavailable}
                        className={`w-full rounded-control border border-hairline bg-surface px-2 py-1.5 text-left transition-colors duration-80 ease-standard hover:border-strong hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset disabled:cursor-not-allowed disabled:text-faint disabled:hover:border-hairline disabled:hover:bg-surface ${styles.border}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-ui font-medium text-primary">
                              {spec.label}
                            </p>
                            {/* A node type id is a literal — mono, verbatim. */}
                            <p className="truncate font-mono text-instrument text-meta">
                              {spec.type}
                            </p>
                          </div>
                          {restricted ? (
                            // One backend logo per store the node works with;
                            // a single tooltip carries the "only available on"
                            // detail so the row stays uncluttered and new
                            // backends just add another icon.
                            <Tooltip
                              content={`Only available on ${backendSupportLabel(restricted)}`}
                              side="left"
                              triggerClassName="mt-0.5 shrink-0 items-center gap-1"
                            >
                              {restricted.map((backend) => (
                                <IndexBackendIcon
                                  key={backend}
                                  backend={backend}
                                  className="h-3.5 w-3.5 shrink-0"
                                />
                              ))}
                            </Tooltip>
                          ) : null}
                        </div>
                      </button>
                      {spec.presets && spec.presets.length > 0 ? (
                        <div className="mt-1 space-y-1 pl-3">
                          {spec.presets.map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              draggable={!unavailable}
                              onClick={() => onPreviewNode(presetizedSpec(spec, preset))}
                              onDragStart={(event) => handleDragStart(event, spec, preset)}
                              className="w-full rounded-control border border-hairline bg-canvas px-2 py-1 text-left transition-colors duration-80 ease-standard hover:border-strong hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset"
                            >
                              <span className="block truncate text-instrument font-medium text-body">
                                {preset.label}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {unavailable ? (
                        <p className="mt-1 px-1 text-instrument text-muted">
                          {rerankingProviderMessage}{" "}
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
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
