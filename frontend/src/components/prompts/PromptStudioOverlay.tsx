"use client";

import { X } from "lucide-react";
import { useId } from "react";

import { ModalOverlay } from "@/components/ui/modal-overlay";
import { Tooltip } from "@/components/ui/tooltip";

import { PromptStudio } from "./PromptStudio";

import type { OpenUsage } from "./PromptStudio";
import type { PromptRead } from "@/lib/types";

interface PromptStudioOverlayProps {
  /** The prompt to open on — the node's current reference. */
  promptId: string;
  /** The user forked; the caller repoints whatever referenced the source. */
  onForked?: (fork: PromptRead) => void;
  /** Follow a "used by" entry in the surface underneath, without navigating. */
  onOpenUsage?: OpenUsage;
  onClose: () => void;
}

/**
 * The studio over the pipeline editor.
 *
 * Tuning a node's prompt is an inner loop — edit, test, edit again — and
 * navigating to the Prompts page for it costs the user their unsaved
 * graph and their place on the canvas. Here the graph stays mounted
 * underneath and closing returns to it.
 */
export function PromptStudioOverlay({
  promptId,
  onForked,
  onOpenUsage,
  onClose,
}: PromptStudioOverlayProps) {
  const titleId = useId();
  return (
    <ModalOverlay open onClose={onClose} labelledBy={titleId}>
      <div className="card-surface flex h-[92vh] w-[94vw] flex-col bg-canvas-raised shadow-elevation-2">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-hairline px-3 py-2">
          <h2 id={titleId} className="text-head font-semibold tracking-[-0.01em] text-primary">
            Prompt studio
          </h2>
          <Tooltip content="Close">
            <button
              type="button"
              aria-label="Close prompt studio"
              onClick={onClose}
              className="rounded-chip p-1 text-muted transition-colors duration-80 ease-standard hover:bg-surface-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </Tooltip>
        </div>
        <div className="min-h-0 flex-1">
          <PromptStudio
            initialPromptId={promptId}
            onForked={(fork) => {
              onForked?.(fork);
            }}
            onOpenUsage={onOpenUsage}
          />
        </div>
      </div>
    </ModalOverlay>
  );
}
