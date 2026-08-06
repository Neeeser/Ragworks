import { InstrumentLabel } from "@/components/ui/instrument-label";

import type { ReactNode } from "react";

/** What a node produced, in a card that reads as this node's output. */
export function OutcomeCard({
  label,
  right,
  children,
}: {
  label: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-panel border border-accent-cyan/25 bg-accent-cyan/5 p-3">
      <div className="flex items-baseline gap-2">
        <InstrumentLabel>{label}</InstrumentLabel>
        {right}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}
