import type { ReactNode } from "react";

/**
 * The two prose shapes every node explanation shares: the one sentence it
 * opens with, and the note describing what the focused chunk did here.
 *
 * Both cap their measure — the evidence pane is full-width, the sentence in it
 * is not.
 */

/** The one sentence a node's explanation opens with. */
export function Lede({ children }: { children: ReactNode }) {
  return <p className="max-w-[66ch] text-ui leading-relaxed text-body">{children}</p>;
}

/** What the focused chunk did at this node, in the node's own vocabulary. */
export function EffectNote({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-[66ch] rounded-control border border-accent-cyan/30 bg-accent-cyan/5 p-3 text-ui text-primary">
      {children}
    </p>
  );
}
