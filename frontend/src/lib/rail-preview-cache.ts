"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import {
  PIPELINE_KIND_LABELS,
  isPipelineKind,
  pipelineKindHref,
} from "@/components/pipelines/lib/pipeline-kinds";
import {
  fetchCollections,
  fetchEvalRuns,
  fetchPipelines,
  listChatSessions,
  listPrompts,
} from "@/lib/api";
import { formatTimeAgoCompact } from "@/lib/format";
import { SharedQueryStore } from "@/lib/shared-query-store";

import type { PipelineKind, UUID } from "@/lib/types";

/** One row in a rail flyout: a real destination, never a decorative summary. */
export interface RailPreviewItem {
  id: string;
  label: string;
  href: string;
  /** Right-aligned instrument value — a relative time, a count, a status. */
  meta?: string;
}

interface RailPreviewSection {
  /**
   * One factual line: what this section is. The rail is icon-only, so this is
   * the only place the console says what `Evals` or `Pipelines` actually means.
   */
  description: string;
  /** Instrument label over the item list. */
  itemsLabel?: string;
  /** Copy for a section that loaded successfully with nothing in it. */
  emptyLabel?: string;
  /** Destinations that need no request. */
  items?: RailPreviewItem[];
  /** Fetched the first time the flyout opens, then retained for the session. */
  load?: (token: string) => Promise<RailPreviewItem[]>;
}

/** A preview is a shortcut list, not a second copy of the page. */
const MAX_ITEMS = 5;

function mostRecentlyUpdated<T extends { updated_at: string }>(rows: T[]): T[] {
  return [...rows]
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .slice(0, MAX_ITEMS);
}

const SECTIONS: Record<string, RailPreviewSection | undefined> = {
  "/dashboard": {
    description: "Ingestion and retrieval activity across every collection.",
  },
  "/collections": {
    description: "Document corpora, each bound to an ingestion pipeline and a search tool.",
    itemsLabel: "Recent",
    emptyLabel: "No collections yet.",
    load: async (token) =>
      mostRecentlyUpdated(await fetchCollections(token)).map((collection) => ({
        id: collection.id,
        label: collection.name,
        href: `/collections/${collection.id}`,
        meta: formatTimeAgoCompact(collection.updated_at),
      })),
  },
  "/chat": {
    description: "Chat and query sessions run against a collection's search tool.",
    itemsLabel: "Recent",
    emptyLabel: "No sessions yet.",
    load: async (token) =>
      mostRecentlyUpdated(await listChatSessions(token, { includeUnassigned: true })).map(
        (session) => ({
          id: session.id,
          label: session.title,
          href: `/chat/${session.id}`,
          meta: formatTimeAgoCompact(session.updated_at),
        }),
      ),
  },
  "/pipelines": {
    description: "Ingestion graphs and search tools, versioned on every change.",
    itemsLabel: "Kinds",
    emptyLabel: "No pipelines yet.",
    // Derived from the pipelines themselves rather than a second copy of the
    // kind list: a hardcoded list here would drift the day a kind is added.
    load: async (token) => {
      const counts = new Map<PipelineKind, number>();
      for (const pipeline of await fetchPipelines(token)) {
        if (!isPipelineKind(pipeline.kind)) continue;
        counts.set(pipeline.kind, (counts.get(pipeline.kind) ?? 0) + 1);
      }
      return [...counts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([kind, count]) => ({
          id: kind,
          label: PIPELINE_KIND_LABELS[kind],
          href: pipelineKindHref(kind),
          meta: String(count),
        }));
    },
  },
  "/prompts": {
    description: "Versioned prompt templates that chat, collections, and pipeline nodes reference.",
    itemsLabel: "Recent",
    emptyLabel: "No prompts yet.",
    // The API already returns the user's prompts most-recently-updated first,
    // and a prompt's `updated_at` is unset until its first save — re-sorting
    // here on a possibly-absent field would order worse, not better.
    load: async (token) =>
      (await listPrompts(token)).slice(0, MAX_ITEMS).map((prompt) => ({
        id: prompt.id,
        label: prompt.name,
        href: `/prompts?prompt=${prompt.id}`,
        meta: `v${prompt.current_version}`,
      })),
  },
  "/evals": {
    description: "Retrieval quality scored over a benchmark dataset.",
    itemsLabel: "Recent runs",
    emptyLabel: "No runs yet.",
    load: async (token) => {
      const runs = await fetchEvalRuns(token);
      return [...runs]
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        .slice(0, MAX_ITEMS)
        .map((run) => ({
          id: run.id,
          label: run.name?.trim() || `Run ${run.id.slice(0, 8)}`,
          href: `/evals/runs/${run.id}`,
          meta: run.status,
        }));
    },
  },
  "/admin": {
    description: "Users, runtime configuration, and recorded usage.",
    itemsLabel: "Pages",
    items: [
      { id: "users", label: "Users", href: "/admin/users" },
      { id: "settings", label: "Settings", href: "/admin/settings" },
      { id: "telemetry", label: "Telemetry", href: "/admin/usage" },
      { id: "ledger", label: "Ledger", href: "/admin/usage/ledger" },
    ],
  },
};

interface PreviewKey {
  userId: UUID;
  href: string;
}

const store = new SharedQueryStore<PreviewKey, RailPreviewItem[]>(
  (key) => `${key.userId}:${key.href}`,
);

/** Whether a rail item has a preview, so the rail can fall back to a tooltip. */
export function hasRailPreview(href: string): boolean {
  return SECTIONS[href] !== undefined;
}

export interface RailPreviewSnapshot {
  description: string;
  itemsLabel?: string;
  emptyLabel?: string;
  /** `null` until the section's items resolve; sections may have none at all. */
  items: RailPreviewItem[] | null;
  /** True when this section lists items, so the flyout can reserve their space. */
  listsItems: boolean;
  loading: boolean;
  error: string | null;
}

/**
 * A rail section's preview, fetched on first open and retained for the session.
 *
 * Called from the flyout, which mounts only while a rail item is hovered or
 * focused — so a page load pays nothing for chrome the user may never open, and
 * re-opening the same flyout costs nothing either. Going through the shared
 * query store (not a local cache) is what dedupes a fast hover-hover and lets
 * sign-out drop another user's data.
 */
export function useRailPreview(
  href: string,
  userId: UUID | null | undefined,
  token: string,
): RailPreviewSnapshot | null {
  const section = SECTIONS[href];
  const key = useMemo<PreviewKey>(() => ({ userId: userId ?? "", href }), [href, userId]);
  const subscribe = useCallback((listener: () => void) => store.subscribe(key, listener), [key]);
  const getSnapshot = useCallback(() => store.snapshot(key), [key]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const loader = section?.load;
  const canLoad = Boolean(loader) && Boolean(userId) && Boolean(token);
  const resolved = snapshot.data !== null && !snapshot.invalidated;

  useEffect(() => {
    if (!loader || !canLoad || resolved) return;
    void store.revalidate(key, () => loader(token));
  }, [canLoad, key, loader, resolved, token]);

  if (!section) return null;
  return {
    description: section.description,
    itemsLabel: section.itemsLabel,
    emptyLabel: section.emptyLabel,
    items: section.items ?? snapshot.data,
    listsItems: Boolean(section.items ?? section.load),
    loading: snapshot.loading,
    error: snapshot.error,
  };
}

/** Drop a signed-out user's previews so the next account never sees them. */
export function clearRailPreviewsForUser(userId: UUID): void {
  store.removeMatching((key) => key.userId === userId);
}
