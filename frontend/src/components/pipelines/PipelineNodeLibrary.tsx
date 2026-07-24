"use client";

import Link from "next/link";

import { Tooltip } from "../ui/tooltip";

import { IndexBackendIcon } from "./icons/IndexBackendIcon";
import { backendSupportLabel, restrictedBackends } from "./lib/backend-support";
import { getNodeFamilyLabel, getNodeFamilyStyles, type NodeFamily } from "./lib/pipeline-theme";
import { RERANKER_NODE_TYPE, RERANKER_PROVIDER_REQUIRED } from "./lib/reranking";

import type { IndexBackend, NodeSpec } from "@/lib/types";
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
  const handleDragStart = (event: DragEvent<HTMLButtonElement>, spec: NodeSpec) => {
    if (spec.type === RERANKER_NODE_TYPE && !hasRerankingProvider) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData(NODE_DRAG_TYPE, spec.type);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="mt-6 border-t border-hairline pt-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted">Node library</p>
      <p className="mt-2 text-xs text-meta">Drag nodes into the canvas to add them.</p>
      <div className="mt-3 space-y-4">
        {catalog.map(({ family, specs }) => {
          const styles = getNodeFamilyStyles(family);
          return (
            <div key={family}>
              <p className={`text-xs uppercase tracking-[0.3em] ${styles.badge}`}>
                {getNodeFamilyLabel(family)}
              </p>
              <div className="mt-2 space-y-2">
                {specs.map((spec) => {
                  const unavailable = spec.type === RERANKER_NODE_TYPE && !hasRerankingProvider;
                  // Restriction is informational: a store-bound node still
                  // drags onto the canvas so a user can build a pipeline for
                  // a backend they haven't selected yet — validation is the
                  // hard gate. The badge just sets expectations up front.
                  const restricted = restrictedBackends(spec, knownBackends);
                  return (
                    <div key={spec.type} className="space-y-2">
                      <button
                        type="button"
                        onClick={() => onPreviewNode(spec)}
                        onDragStart={(event) => handleDragStart(event, spec)}
                        draggable={!unavailable}
                        disabled={unavailable}
                        className={`w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-left text-xs text-body ${styles.border} hover:border-strong disabled:cursor-not-allowed disabled:text-faint disabled:hover:border-hairline`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold">{spec.label}</p>
                            <p className="text-[10px] text-meta">{spec.type}</p>
                          </div>
                          {restricted ? (
                            // One backend logo per store the node works with;
                            // a single tooltip carries the "only available on"
                            // detail so the row stays uncluttered and new
                            // backends just add another icon.
                            <Tooltip
                              content={`Only available on ${backendSupportLabel(restricted)}`}
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
                      {unavailable ? (
                        <p className="text-xs text-muted">
                          {rerankingProviderMessage}{" "}
                          <Link
                            href="/settings"
                            className="text-accent-cyan underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
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
