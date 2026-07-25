"use client";

import { Chip } from "@/components/ui/chip";
import { CrumbBar } from "@/components/ui/crumb-bar";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { PulseWire } from "@/components/ui/pulse-wire";
import { Tooltip } from "@/components/ui/tooltip";

import type { Crumb } from "@/components/ui/crumb-bar";

type ChatStudioHeaderProps = {
  /** The open session's title; absent before the first message creates one. */
  sessionTitle: string | null;
  /** How many collections back the model's tools, already summarised. */
  collectionLabel: string;
  collectionMetaLabel: string;
  toolsEnabled: boolean;
  /** The model this turn will run on — an identifier, rendered verbatim. */
  currentModelLabel: string;
  streaming: boolean;
  onModelSelect: () => void;
};

/**
 * Chat Studio's top bar: the breadcrumb path, what this turn will run with, and
 * the page's actions.
 *
 * The run's identity — collections, model, whether tokens are flowing right now
 * — is live state, so it belongs here rather than in a title block the page
 * renders for itself. The model reads as the literal the API accepts, and the
 * pulse runs only while a response is actually streaming.
 */
export function ChatStudioHeader({
  sessionTitle,
  collectionLabel,
  collectionMetaLabel,
  toolsEnabled,
  currentModelLabel,
  streaming,
  onModelSelect,
}: ChatStudioHeaderProps) {
  const crumbs: Crumb[] = [{ label: "Chat Studio", href: "/chat" }];
  if (sessionTitle) {
    crumbs.push({ label: sessionTitle });
  }

  return (
    <CrumbBar
      crumbs={crumbs}
      state={
        <>
          {toolsEnabled ? (
            <Tooltip content={collectionMetaLabel} side="bottom">
              <Chip tone="retrieve">{collectionLabel}</Chip>
            </Tooltip>
          ) : null}
          <Tooltip content="Change the chat model" side="bottom" triggerClassName="min-w-0">
            <button
              type="button"
              onClick={onModelSelect}
              className="flex min-w-0 items-center gap-2 rounded-control px-1.5 py-0.5 transition-colors duration-80 ease-standard hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
            >
              <InstrumentLabel>Model</InstrumentLabel>
              <span className="truncate font-mono text-ui text-primary">{currentModelLabel}</span>
            </button>
          </Tooltip>
          {streaming ? <PulseWire label="Streaming response" className="w-16 shrink-0" /> : null}
        </>
      }
    />
  );
}
