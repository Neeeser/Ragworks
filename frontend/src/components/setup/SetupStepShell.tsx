"use client";

import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

interface SetupStepShellProps {
  /** Remounts the shell per step so the entrance animation replays. */
  stepKey: string;
  direction: 1 | -1;
  kicker: string;
  title: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}

/**
 * Shared frame for one wizard step: kicker, title, body, action row, on the
 * console card material so the step reads as a finished object over the live
 * pipeline backdrop. The backdrop deliberately parks its focused node *above*
 * this card (see `SetupFlowBackdrop`), so the card never covers it.
 */
export function SetupStepShell({
  stepKey,
  direction,
  kicker,
  title,
  children,
  footer,
}: SetupStepShellProps) {
  return (
    <section
      key={stepKey}
      className={cn("w-full", direction === 1 ? "setup-step-forward" : "setup-step-back")}
    >
      <Panel className="flex flex-col gap-3 p-4">
        <header>
          <InstrumentLabel>{kicker}</InstrumentLabel>
          <h1 className="text-head font-semibold tracking-[-0.01em] text-primary">{title}</h1>
        </header>
        <div className="space-y-3">{children}</div>
        <footer className="flex items-center justify-between gap-3 border-t border-hairline pt-3">
          {footer}
        </footer>
      </Panel>
    </section>
  );
}
