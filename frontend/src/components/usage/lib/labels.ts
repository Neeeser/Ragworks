/** Display vocabulary for the ledger's enums, plus per-unit quantity reading. */

import { formatCount, formatUsd } from "@/lib/format";

import type { ChipTone } from "@/components/ui/chip";
import type { UsageGroupBy, UsageKind, UsageSurface, UsageUnit } from "@/lib/types";

/** The order kinds are listed and coloured in — fixed, so a kind keeps its
 * series slot when another kind drops out of the range. */
export const KIND_ORDER: UsageKind[] = [
  "chat",
  "embedding",
  "rerank",
  "vector_store_read",
  "vector_store_write",
];

export const KIND_LABELS: Record<UsageKind, string> = {
  chat: "Chat",
  embedding: "Embedding",
  rerank: "Rerank",
  vector_store_read: "Store read",
  vector_store_write: "Store write",
};

/** The pipeline stage each kind belongs to, so the chip speaks the editor's
 * colour language rather than inventing a second one. */
export const KIND_TONES: Record<UsageKind, ChipTone> = {
  chat: "chat",
  embedding: "embed",
  rerank: "rerank",
  vector_store_read: "retrieve",
  vector_store_write: "index",
};

export const SURFACE_LABELS: Record<UsageSurface, string> = {
  chat: "Chat",
  studio: "Studio",
  ingestion: "Ingestion",
  eval_generation: "Eval generation",
  eval_run: "Eval run",
  connection_test: "Connection test",
};

export const UNIT_LABELS: Record<UsageUnit, string> = {
  tokens: "Tokens",
  search_units: "Search units",
  read_units: "Read units",
};

export const GROUP_BY_LABELS: Record<UsageGroupBy, string> = {
  model: "Model",
  kind: "Kind",
  surface: "Surface",
  connection: "Connection",
  user: "User",
};

/** What every usage surface says about a range that recorded nothing — one
 * string, so two panels on the same page never phrase it differently. */
export const EMPTY_RANGE_COPY = "No usage recorded in this range.";

/** A group with no value on the grouped dimension — a call made through a
 * connection that has since been deleted, not a group named "none". */
export const UNATTRIBUTED = "Unattributed";

/** What a group row is called: its own name where it has one, else its key. */
export function groupRowLabel(
  groupBy: UsageGroupBy,
  key: string | null,
  label: string | null,
): string {
  if (label) return label;
  if (key === null) return UNATTRIBUTED;
  if (groupBy === "kind") return KIND_LABELS[key as UsageKind] ?? key;
  if (groupBy === "surface") return SURFACE_LABELS[key as UsageSurface] ?? key;
  return key;
}

/** A model id or connection id is a literal; a kind or surface is a word. */
export function groupRowIsIdentifier(groupBy: UsageGroupBy): boolean {
  return groupBy === "model" || groupBy === "connection";
}

/** "12,340 tokens" — the count with the unit it was measured in, never summed
 * across units. */
export function formatQuantity(quantity: number, unit: UsageUnit): string {
  return `${formatCount(quantity)} ${UNIT_LABELS[unit].toLowerCase()}`;
}

/**
 * A cost, or an em-dash where the aggregate counted an unpriced event.
 *
 * `$0.00` for an unpriced call claims the provider charged nothing, which is a
 * different fact from nobody publishing a price.
 */
export function formatCostCell(cost: number | null): string {
  return cost === null ? "—" : formatUsd(cost);
}
