"use client";

import Link from "next/link";

import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Skeleton } from "@/components/ui/skeleton";
import { useRailPreview } from "@/lib/rail-preview-cache";
import { useAuth } from "@/providers/auth-provider";

import type { RailPreviewItem } from "@/lib/rail-preview-cache";

type RailFlyoutProps = {
  /** The rail item's route — also the key its preview is registered under. */
  href: string;
  label: string;
  /** Wired to `aria-describedby` on the rail link. */
  descriptionId: string;
  /** Dismiss the flyout once a destination inside it is taken. */
  onNavigate: () => void;
};

const ROW =
  "flex items-center gap-3 rounded-control px-2 py-1 text-ui text-body transition-colors duration-80 ease-standard hover:bg-surface-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-violet";

/** Skeleton rows at the item rows' final geometry: nothing moves when data lands. */
const SKELETON_WIDTHS = ["w-32", "w-24", "w-28"];

type ItemsProps = {
  label: string;
  items: RailPreviewItem[] | null;
  error: string | null;
  emptyLabel?: string;
  onNavigate: () => void;
};

function RailFlyoutItems({ label, items, error, emptyLabel, onNavigate }: ItemsProps) {
  if (error) return <p className="px-2 text-ui text-data-neg">{error}</p>;

  if (items === null) {
    return (
      <div aria-hidden>
        {SKELETON_WIDTHS.map((width) => (
          <div key={width} className="flex h-7 items-center px-2">
            <Skeleton className={`h-3 ${width}`} />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return <p className="px-2 text-ui text-meta">{emptyLabel}</p>;
  }

  return (
    <ul aria-label={`${label} shortcuts`}>
      {items.map((item) => (
        <li key={item.id}>
          <Link href={item.href} onClick={onNavigate} className={ROW}>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.meta ? (
              <span className="shrink-0 font-mono text-instrument tabular-nums text-meta">
                {item.meta}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The section preview that flies out of the icon rail.
 *
 * The sidebar label already names the section; this adds what a label cannot:
 * one factual line about what the section is, and the handful of destinations a
 * user actually wants (recent collections, recent chats, pipeline kinds with
 * counts).
 *
 * Mounted only while its rail item is hovered or focused, so the fetch behind
 * `useRailPreview` happens on first open and never on page load.
 */
export function RailFlyout({ href, label, descriptionId, onNavigate }: RailFlyoutProps) {
  const { user, token } = useAuth();
  const preview = useRailPreview(href, user?.id, token ?? "");

  if (!preview) return null;

  return (
    <div className="console-flyout w-72 rounded-panel border border-hairline bg-canvas-raised p-2 shadow-elevation-2">
      {/* The title is text, not a link: the rail icon beside it already goes to
          the section, and a second link to the same place is one more tab stop
          and one more identically-named link for a screen reader. */}
      <p className="px-2 pt-1 text-ui font-medium text-primary">{label}</p>
      <p id={descriptionId} className="px-2 pb-1 pt-0.5 text-ui leading-snug text-muted">
        {preview.description}
      </p>

      {preview.listsItems ? (
        <div className="mt-1 border-t border-hairline pt-2">
          {preview.itemsLabel ? (
            <InstrumentLabel className="block px-2 pb-1">{preview.itemsLabel}</InstrumentLabel>
          ) : null}
          <RailFlyoutItems
            label={label}
            items={preview.items}
            error={preview.error}
            emptyLabel={preview.emptyLabel}
            onNavigate={onNavigate}
          />
        </div>
      ) : null}
    </div>
  );
}
