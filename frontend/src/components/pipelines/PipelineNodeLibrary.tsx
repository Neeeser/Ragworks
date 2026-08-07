"use client";

import { LibraryBig, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import { inputClass } from "../ui/field";
import { InstrumentLabel } from "../ui/instrument-label";

import { filterNodeCatalog, type NodeCatalogGroup } from "./lib/node-library-filter";
import { getNodeFamilyLabel, getNodeFamilyStyles, type NodeFamily } from "./lib/pipeline-theme";
import { RERANKER_NODE_TYPE, RERANKER_PROVIDER_REQUIRED } from "./lib/reranking";
import { NodeLibraryRail } from "./NodeLibraryRail";
import { NodeLibraryRow } from "./NodeLibraryRow";

import type { IndexBackend, NodeSpec } from "@/lib/types";

type PipelineNodeLibraryProps = {
  catalog: NodeCatalogGroup[];
  onPreviewNode: (spec: NodeSpec) => void;
  /** Opens the full node catalog overlay. */
  onBrowseAll: () => void;
  /** Canvas labels per node type, folded into the search haystack. */
  instanceLabels?: Record<string, string[]>;
  hasRerankingProvider?: boolean;
  rerankingProviderMessage?: string | null;
  /** Backends this deployment knows about; used to flag backend-restricted nodes. */
  knownBackends?: IndexBackend[];
};

/**
 * The Nodes tab: a category rail filtering a panel of draggable node rows,
 * with search across the whole catalog and the catalog overlay's entry point
 * pinned at the bottom. Built for a catalog that keeps growing — categories
 * collapse into rail dots instead of stacking section after section.
 */
export function PipelineNodeLibrary({
  catalog,
  onPreviewNode,
  onBrowseAll,
  instanceLabels,
  hasRerankingProvider = true,
  rerankingProviderMessage = RERANKER_PROVIDER_REQUIRED,
  knownBackends = [],
}: PipelineNodeLibraryProps) {
  const [activeFamily, setActiveFamily] = useState<NodeFamily | null>(null);
  const [search, setSearch] = useState("");

  const families = useMemo(
    () => catalog.map((group) => ({ family: group.family, count: group.specs.length })),
    [catalog],
  );
  const visible = useMemo(
    () => filterNodeCatalog(catalog, activeFamily, search, instanceLabels),
    [catalog, activeFamily, search, instanceLabels],
  );
  const searching = search.trim().length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative shrink-0 p-2 pb-1.5">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 mt-px h-3.5 w-3.5 -translate-y-1/2 text-meta"
          aria-hidden
        />
        <input
          type="search"
          aria-label="Search nodes"
          placeholder="Search nodes"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className={cn(inputClass, "pl-8")}
        />
      </div>
      <div className="flex min-h-0 flex-1">
        <NodeLibraryRail families={families} active={activeFamily} onSelect={setActiveFamily} />
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {visible.length === 0 ? (
            <p className="px-1 py-2 text-instrument text-muted">
              No nodes match &ldquo;{search.trim()}&rdquo;.
            </p>
          ) : (
            <div className="space-y-3">
              {visible.map(({ family, specs }) => (
                <div key={family}>
                  {/* While one category is pinned the rail already names it, but
                      search results span categories — the header is what says
                      where a hit lives. */}
                  {activeFamily === null || searching ? (
                    <InstrumentLabel className={cn("px-1", getNodeFamilyStyles(family).badge)}>
                      {getNodeFamilyLabel(family)}
                    </InstrumentLabel>
                  ) : null}
                  <div className="mt-1 space-y-1">
                    {specs.map((spec) => (
                      <NodeLibraryRow
                        key={spec.type}
                        spec={spec}
                        family={family}
                        unavailable={spec.type === RERANKER_NODE_TYPE && !hasRerankingProvider}
                        unavailableMessage={rerankingProviderMessage}
                        knownBackends={knownBackends}
                        onPreviewNode={onPreviewNode}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 border-t border-hairline p-2">
        <button
          type="button"
          onClick={onBrowseAll}
          className="flex w-full items-center gap-2 rounded-control border border-hairline bg-surface px-2 py-1.5 text-ui font-medium text-body transition-colors duration-80 ease-standard hover:border-strong hover:bg-surface-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset"
        >
          <LibraryBig className="h-3.5 w-3.5 text-muted" aria-hidden />
          Browse all nodes
        </button>
        {/* Kept: drag-to-add is the only affordance the layout cannot show.
            xl-only — in the bottom sheet the canvas is covered, so the gesture
            does not exist and the hint would mislead. */}
        <InstrumentLabel className="mt-1.5 hidden text-center xl:block">
          Drag nodes onto the canvas
        </InstrumentLabel>
      </div>
    </div>
  );
}
