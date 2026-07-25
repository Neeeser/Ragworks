"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { FileIcon } from "@/components/files/FileIcon";
import { useFileSearch } from "@/components/files/hooks/use-file-search";
import { Checkbox } from "@/components/ui/checkbox";
import { inputClass } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { FileSearchState } from "@/components/files/hooks/use-file-search";
import type { FileContentMatch, FileNode, FileSearchMode } from "@/lib/types";

const MODE_LABELS: Array<{ mode: FileSearchMode; label: string }> = [
  { mode: "name", label: "File names" },
  { mode: "folder", label: "Folders" },
  { mode: "content", label: "Content (semantic)" },
];

const ROW_CLASS =
  "flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors duration-80 ease-standard hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset";

type FileSearchBoxProps = {
  token: string;
  collectionId: string;
  nodes: FileNode[];
  onOpenFolder: (folder: FileNode) => void;
  onSelectFile: (file: FileNode) => void;
};

function GroupLabel({ children }: { children: string }) {
  return (
    <p className="px-2 pb-0.5 pt-2">
      <InstrumentLabel>{children}</InstrumentLabel>
    </p>
  );
}

function ResultRow({ node, onClick }: { node: FileNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={ROW_CLASS}>
      <FileIcon node={node} className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui text-primary">{node.name}</span>
        {/* A path is a literal, so it renders verbatim in mono. */}
        <span className="block truncate font-mono text-instrument text-meta">{node.path}</span>
      </span>
    </button>
  );
}

function ContentRowSkeleton() {
  return (
    <div aria-busy className="space-y-1 px-2 py-1.5">
      {[0, 1].map((row) => (
        <div key={row} className="flex items-center text-ui">
          <Skeleton className="h-2 w-full max-w-56" />
        </div>
      ))}
      <span className="sr-only">Searching content</span>
    </div>
  );
}

type SearchResultsDropdownProps = {
  listId: string;
  results: FileSearchState;
  contentEnabled: boolean;
  contentMatches: Array<FileContentMatch & { file: FileNode }>;
  onChooseFolder: (node: FileNode) => void;
  onChooseFile: (node: FileNode) => void;
};

function SearchResultsDropdown({
  listId,
  results,
  contentEnabled,
  contentMatches,
  onChooseFolder,
  onChooseFile,
}: SearchResultsDropdownProps) {
  const empty = results.folders.length === 0 && results.files.length === 0 && !contentEnabled;
  return (
    <div
      id={listId}
      className="absolute left-0 right-0 top-full z-30 mt-1 max-h-96 overflow-y-auto rounded-panel border border-hairline bg-canvas-raised p-1 shadow-elevation-2"
    >
      {results.folders.length > 0 && (
        <>
          <GroupLabel>Folders</GroupLabel>
          {results.folders.map((node) => (
            <ResultRow key={node.id} node={node} onClick={() => onChooseFolder(node)} />
          ))}
        </>
      )}
      {results.files.length > 0 && (
        <>
          <GroupLabel>Files</GroupLabel>
          {results.files.map((node) => (
            <ResultRow key={node.id} node={node} onClick={() => onChooseFile(node)} />
          ))}
        </>
      )}
      {contentEnabled && (
        <>
          <GroupLabel>Content</GroupLabel>
          {results.contentError && (
            <p className="px-2 py-1.5 text-ui text-data-neg">{results.contentError}</p>
          )}
          {/* Previous matches stay put while a debounced re-query is in flight;
              a skeleton only stands in when there is nothing to keep. */}
          {results.contentLoading && contentMatches.length === 0 && !results.contentError ? (
            <ContentRowSkeleton />
          ) : null}
          {contentMatches.map((match) => (
            <button
              key={match.chunk_id}
              type="button"
              onClick={() => onChooseFile(match.file)}
              className={cn(ROW_CLASS, "flex-col items-stretch gap-0.5")}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-ui text-primary">{match.file.name}</span>
                <span className="shrink-0 font-mono text-instrument tabular-nums text-meta">
                  {match.score.toFixed(2)}
                </span>
              </span>
              <span className="line-clamp-2 text-ui text-muted">{match.snippet}</span>
            </button>
          ))}
          {!results.contentLoading && !results.contentError && contentMatches.length === 0 && (
            <p className="px-2 py-1.5 text-ui text-meta">No content matches.</p>
          )}
        </>
      )}
      {empty && <p className="px-2 py-1.5 text-ui text-meta">No matches.</p>}
    </div>
  );
}

/**
 * One box, three switchable modes. Name and folder matches resolve instantly
 * from the loaded tree; content matches run the collection's retrieval pipeline
 * (debounced), which is why the mode is a filter the user can turn off.
 */
export function FileSearchBox({
  token,
  collectionId,
  nodes,
  onOpenFolder,
  onSelectFile,
}: FileSearchBoxProps) {
  const [query, setQuery] = useState("");
  const [modes, setModes] = useState<Set<FileSearchMode>>(
    () => new Set<FileSearchMode>(["name", "folder", "content"]),
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const results = useFileSearch(token, collectionId, nodes, query, modes);
  const open = focused && results.hasQuery;

  useEffect(() => {
    if (!focused && !filtersOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setFocused(false);
        setFiltersOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [filtersOpen, focused]);

  const toggleMode = (mode: FileSearchMode) => {
    setModes((previous) => {
      const next = new Set(previous);
      if (next.has(mode)) {
        if (next.size > 1) next.delete(mode); // at least one mode stays on
      } else {
        next.add(mode);
      }
      return next;
    });
  };

  const choose = (action: () => void) => {
    action();
    setFocused(false);
    setQuery("");
  };

  const contentMatches = results.content.filter(
    (match): match is FileContentMatch & { file: FileNode } => Boolean(match.file),
  );

  return (
    <div ref={containerRef} className="relative w-full shrink-0 sm:w-56 xl:w-72">
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setFocused(true)}
            placeholder="Search files, folders, content"
            aria-label="Search files"
            aria-controls={open ? listId : undefined}
            className={cn(inputClass, "py-1 pl-7 pr-2")}
          />
        </div>
        {/* Opens downward: the box lives in the browser card's top row, which
            clips its own overflow. */}
        <Tooltip content="Choose which modes to search" side="bottom">
          <button
            type="button"
            onClick={() => setFiltersOpen((value) => !value)}
            aria-label="Search filters"
            aria-expanded={filtersOpen}
            className={cn(
              "flex h-7 w-8 shrink-0 items-center justify-center rounded-control border",
              "transition-colors duration-80 ease-standard focus-visible:outline-none",
              "focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset",
              filtersOpen
                ? "border-accent-violet bg-accent-violet/15 text-accent-violet"
                : "border-hairline text-muted hover:border-strong hover:text-primary",
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
          </button>
        </Tooltip>
      </div>

      {/* The filters panel sits above the results dropdown (z-30), which shares this anchor. */}
      {filtersOpen && (
        <div className="absolute right-0 top-full z-40 mt-1 w-56 rounded-panel border border-hairline bg-canvas-raised p-3 shadow-elevation-2">
          <InstrumentLabel>Search in</InstrumentLabel>
          <div className="mt-2 space-y-2">
            {MODE_LABELS.map(({ mode, label }) => (
              <Checkbox
                key={mode}
                checked={modes.has(mode)}
                onChange={() => toggleMode(mode)}
                label={label}
              />
            ))}
          </div>
        </div>
      )}

      {open && (
        <SearchResultsDropdown
          listId={listId}
          results={results}
          contentEnabled={modes.has("content")}
          contentMatches={contentMatches}
          onChooseFolder={(node) => choose(() => onOpenFolder(node))}
          onChooseFile={(node) => choose(() => onSelectFile(node))}
        />
      )}
    </div>
  );
}
