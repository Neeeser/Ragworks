"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { FileIcon } from "@/components/files/FileIcon";
import { useFileSearch } from "@/components/files/hooks/use-file-search";
import { Loader } from "@/components/ui/loader";
import { cn } from "@/lib/utils";

import type { FileSearchState } from "@/components/files/hooks/use-file-search";
import type { FileContentMatch, FileNode, FileSearchMode } from "@/lib/types";

const MODE_LABELS: Array<{ mode: FileSearchMode; label: string }> = [
  { mode: "name", label: "File names" },
  { mode: "folder", label: "Folders" },
  { mode: "content", label: "Content (semantic)" },
];

const GROUP_LABEL_CLASS = "px-3 pt-2 font-mono text-[11px] uppercase tracking-[0.28em] text-muted";

type FileSearchBoxProps = {
  token: string;
  collectionId: string;
  nodes: FileNode[];
  onOpenFolder: (folder: FileNode) => void;
  onSelectFile: (file: FileNode) => void;
};

function ResultRow({ node, onClick }: { node: FileNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
    >
      <FileIcon node={node} className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-primary">{node.name}</span>
        <span className="block truncate text-xs text-meta">{node.path}</span>
      </span>
    </button>
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
      className="absolute left-0 right-0 top-11 z-30 max-h-[26rem] overflow-y-auto rounded-2xl border border-hairline bg-canvas-raised p-2 shadow-elevation-2"
    >
      {results.folders.length > 0 && (
        <>
          <p className={GROUP_LABEL_CLASS}>Folders</p>
          {results.folders.map((node) => (
            <ResultRow key={node.id} node={node} onClick={() => onChooseFolder(node)} />
          ))}
        </>
      )}
      {results.files.length > 0 && (
        <>
          <p className={GROUP_LABEL_CLASS}>Files</p>
          {results.files.map((node) => (
            <ResultRow key={node.id} node={node} onClick={() => onChooseFile(node)} />
          ))}
        </>
      )}
      {contentEnabled && (
        <>
          <p className={cn(GROUP_LABEL_CLASS, "flex items-center gap-2")}>
            Content
            {results.contentLoading && <Loader className="h-3 w-3" />}
          </p>
          {results.contentError && (
            <p className="px-3 py-2 text-xs text-data-neg">{results.contentError}</p>
          )}
          {contentMatches.map((match) => (
            <button
              key={match.chunk_id}
              type="button"
              onClick={() => onChooseFile(match.file)}
              className="flex w-full flex-col gap-1 rounded-2xl px-3 py-2 text-left transition hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm text-primary">{match.file.name}</span>
                <span className="font-mono text-[10px] text-meta">{match.score.toFixed(2)}</span>
              </span>
              <span className="line-clamp-2 text-xs text-muted">{match.snippet}</span>
            </button>
          ))}
          {!results.contentLoading && !results.contentError && contentMatches.length === 0 && (
            <p className="px-3 py-2 text-xs text-meta">No content matches.</p>
          )}
        </>
      )}
      {empty && <p className="px-3 py-2 text-xs text-meta">No matches.</p>}
    </div>
  );
}

/**
 * The header search: one box, three switchable modes. Name/folder matches
 * resolve instantly from the loaded tree; content matches run the
 * collection's retrieval pipeline (debounced).
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
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setFocused(true)}
            placeholder="Search files, folders, content…"
            aria-label="Search files"
            aria-controls={open ? listId : undefined}
            className="w-full rounded-2xl border border-hairline bg-surface py-2 pl-9 pr-3 text-sm text-primary placeholder:text-meta focus:border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
          />
        </div>
        <button
          type="button"
          onClick={() => setFiltersOpen((value) => !value)}
          aria-label="Search filters"
          aria-expanded={filtersOpen}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition",
            filtersOpen
              ? "border-accent-violet text-accent-violet"
              : "border-hairline text-body hover:border-strong",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {filtersOpen && (
        <div className="absolute right-0 top-11 z-30 w-56 rounded-2xl border border-hairline bg-canvas-raised p-3 shadow-elevation-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">Search in</p>
          <div className="mt-2 space-y-1.5">
            {MODE_LABELS.map(({ mode, label }) => (
              <label
                key={mode}
                className="flex cursor-pointer items-center gap-2 text-sm text-body"
              >
                <input
                  type="checkbox"
                  checked={modes.has(mode)}
                  onChange={() => toggleMode(mode)}
                  className="h-4 w-4 accent-[var(--accent-violet)]"
                />
                {label}
              </label>
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
