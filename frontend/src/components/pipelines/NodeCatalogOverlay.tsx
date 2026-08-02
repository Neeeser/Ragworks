"use client";

import { Search, X } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import { inputClass } from "../ui/field";
import { ModalOverlay } from "../ui/modal-overlay";

import { IndexBackendIcon } from "./icons/IndexBackendIcon";
import { restrictedBackends } from "./lib/backend-support";
import { resolveNodeDescription } from "./lib/node-content";
import { filterNodeCatalog, firstSentence, type NodeCatalogGroup } from "./lib/node-library-filter";
import { getNodeFamilyLabel, getNodeFamilyStyles, type NodeFamily } from "./lib/pipeline-theme";
import { presetizedSpec } from "./lib/presets";
import { RERANKER_NODE_TYPE, RERANKER_PROVIDER_REQUIRED } from "./lib/reranking";
import { NodeCatalogDetail } from "./NodeCatalogDetail";

import type { IndexBackend, NodePreset, NodeSpec } from "@/lib/types";

type NodeCatalogOverlayProps = {
  catalog: NodeCatalogGroup[];
  onClose: () => void;
  /** Adds the (possibly presetized) spec to the canvas; the caller closes. */
  onAddNode: (spec: NodeSpec) => void;
  hasRerankingProvider?: boolean;
  rerankingProviderMessage?: string | null;
  knownBackends?: IndexBackend[];
};

/** One selectable list entry: a node, or one of its presets viewed standalone. */
type CatalogEntry = {
  key: string;
  spec: NodeSpec;
  family: NodeFamily;
  preset?: NodePreset;
};

const entriesForGroup = (group: NodeCatalogGroup, searching: boolean): CatalogEntry[] =>
  group.specs.flatMap((spec) => {
    const shell: CatalogEntry = { key: spec.type, spec, family: group.family };
    // Presets surface as peer rows only under search — browsing shows them in
    // the shell's detail pane, so the list stays one row per node type.
    if (!searching) return [shell];
    return [
      shell,
      ...(spec.presets ?? []).map((preset) => ({
        key: `${spec.type}:${preset.id}`,
        spec,
        family: group.family,
        preset,
      })),
    ];
  });

/** One list row: dot + label, preset/count pill, backend icons, one-line blurb. */
function CatalogEntryRow({
  entry,
  selected,
  knownBackends,
  onFocus,
}: {
  entry: CatalogEntry;
  selected: boolean;
  knownBackends: IndexBackend[];
  onFocus: () => void;
}) {
  const styles = getNodeFamilyStyles(entry.family);
  const restricted = restrictedBackends(entry.spec, knownBackends);
  const description = entry.preset ? entry.preset.description : resolveNodeDescription(entry.spec);
  const pill = entry.preset
    ? "preset"
    : entry.spec.presets && entry.spec.presets.length > 0
      ? `${entry.spec.presets.length} presets`
      : null;
  return (
    <button
      type="button"
      onClick={onFocus}
      className={cn(
        "w-full rounded-control border px-3 py-2 text-left transition-colors duration-80 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset",
        selected
          ? "border-accent-violet/60 bg-accent-violet/10"
          : "border-hairline bg-surface hover:border-strong hover:bg-surface-strong",
      )}
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-[2px]",
            styles.accent,
            entry.preset && "opacity-50",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-primary">
          {entry.preset ? entry.preset.label : entry.spec.label}
        </span>
        {pill ? (
          <span className="shrink-0 rounded-full border border-hairline px-1.5 text-instrument text-meta">
            {pill}
          </span>
        ) : null}
        {restricted ? (
          <span className="flex shrink-0 items-center gap-1">
            {restricted.map((backend) => (
              <IndexBackendIcon key={backend} backend={backend} className="h-3.5 w-3.5 shrink-0" />
            ))}
          </span>
        ) : null}
      </span>
      {description ? (
        <span className="mt-1 block truncate text-instrument text-muted">
          {firstSentence(description)}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The full node catalog with room to read it: labeled categories on the left,
 * node rows with one-line descriptions in the middle, and everything known
 * about the focused entry on the right — mirroring the model browser, so the
 * app's two big catalogs feel like one system. Below `lg` the panes collapse
 * the same way: the list fills the sheet and the detail slides over it.
 */
export function NodeCatalogOverlay({
  catalog,
  onClose,
  onAddNode,
  hasRerankingProvider = true,
  rerankingProviderMessage = RERANKER_PROVIDER_REQUIRED,
  knownBackends = [],
}: NodeCatalogOverlayProps) {
  const titleId = useId();
  const [search, setSearch] = useState("");
  const [family, setFamily] = useState<NodeFamily | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  const searching = search.trim().length > 0;
  const visible = useMemo(
    () => filterNodeCatalog(catalog, family, search),
    [catalog, family, search],
  );
  const entries = useMemo(
    () => visible.flatMap((group) => entriesForGroup(group, searching)),
    [visible, searching],
  );
  const totalCount = useMemo(
    () => catalog.reduce((sum, group) => sum + group.specs.length, 0),
    [catalog],
  );

  const focused = entries.find((entry) => entry.key === focusedKey) ?? null;
  const focusedSpec = focused
    ? focused.preset
      ? presetizedSpec(focused.spec, focused.preset)
      : focused.spec
    : null;
  const focusedUnavailable = Boolean(
    focused && focused.spec.type === RERANKER_NODE_TYPE && !hasRerankingProvider,
  );

  return (
    <ModalOverlay
      open
      onClose={onClose}
      labelledBy={titleId}
      backdropClassName="bg-canvas/80 px-0 py-0 sm:px-4 sm:py-8"
    >
      <div className="card-surface relative flex h-[100dvh] w-full flex-col overflow-hidden bg-canvas-raised text-primary shadow-elevation-2 sm:h-[calc(100vh-4rem)] sm:max-w-5xl">
        <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
          <h2 id={titleId} className="shrink-0 text-head font-semibold tracking-[-0.01em]">
            Node catalog
          </h2>
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-meta"
              aria-hidden
            />
            <input
              type="search"
              aria-label="Search nodes and presets"
              className={cn(inputClass, "pl-9")}
              placeholder="Search nodes and presets"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <button
            type="button"
            aria-label="Close node catalog"
            onClick={onClose}
            className="shrink-0 rounded-control p-1 text-muted hover:text-primary"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="hidden w-44 shrink-0 overflow-y-auto border-r border-hairline bg-surface p-2 lg:block">
            <button
              type="button"
              aria-pressed={family === null}
              onClick={() => setFamily(null)}
              className={cn(
                "flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-ui transition-colors duration-80 ease-standard",
                family === null
                  ? "bg-surface-strong font-medium text-primary"
                  : "text-body hover:bg-surface",
              )}
            >
              All nodes
              <span className="ml-auto font-mono text-instrument text-meta">{totalCount}</span>
            </button>
            {catalog.map((group) => (
              <button
                key={group.family}
                type="button"
                aria-pressed={family === group.family}
                onClick={() =>
                  setFamily((current) => (current === group.family ? null : group.family))
                }
                className={cn(
                  "flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-ui transition-colors duration-80 ease-standard",
                  family === group.family
                    ? "bg-surface-strong font-medium text-primary"
                    : "text-body hover:bg-surface",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-[2px]",
                    getNodeFamilyStyles(group.family).accent,
                  )}
                />
                {getNodeFamilyLabel(group.family)}
                <span className="ml-auto font-mono text-instrument text-meta">
                  {group.specs.length}
                </span>
              </button>
            ))}
          </div>

          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto p-3 lg:w-[42%] lg:flex-none lg:border-r lg:border-hairline",
              focused && "hidden lg:block",
            )}
          >
            {entries.length === 0 ? (
              <p className="px-1 py-2 text-instrument text-muted">
                No nodes match &ldquo;{search.trim()}&rdquo;.
              </p>
            ) : (
              <div className="space-y-1.5">
                {entries.map((entry) => (
                  <CatalogEntryRow
                    key={entry.key}
                    entry={entry}
                    selected={entry.key === focusedKey}
                    knownBackends={knownBackends}
                    onFocus={() => setFocusedKey(entry.key)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* min-w-0: without it the pane's min-width is its content and it
              overflows the card instead of wrapping. */}
          <div className={cn("min-h-0 min-w-0 flex-1", !focused && "hidden lg:block")}>
            {focusedSpec && focused ? (
              <div className="flex h-full min-h-0 flex-col">
                <button
                  type="button"
                  onClick={() => setFocusedKey(null)}
                  className="shrink-0 border-b border-hairline px-4 py-2 text-left text-instrument font-medium text-muted hover:text-primary lg:hidden"
                >
                  ← Back to list
                </button>
                <NodeCatalogDetail
                  spec={focusedSpec}
                  knownBackends={knownBackends}
                  unavailable={focusedUnavailable}
                  unavailableMessage={focusedUnavailable ? rerankingProviderMessage : null}
                  onAdd={onAddNode}
                />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center p-6">
                <p className="text-instrument text-muted">Select a node to read about it.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
