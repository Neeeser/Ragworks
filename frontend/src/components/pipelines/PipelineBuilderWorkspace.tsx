"use client";

import { PageBody } from "@/components/ui/app-shell";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";

import { PipelineCanvas } from "./PipelineCanvas";
import { PipelineSidebar } from "./PipelineSidebar";

import type { ComponentProps, KeyboardEvent, PointerEvent } from "react";

type PipelineBuilderWorkspaceProps = {
  loading: boolean;
  sidebar: ComponentProps<typeof PipelineSidebar>;
  canvas: ComponentProps<typeof PipelineCanvas>;
  resize: {
    width: number;
    startResize: (event: PointerEvent<HTMLDivElement>) => void;
    resizeBy: (delta: number) => void;
  };
};

/** The editor's geometry while it loads — same two panes, no content yet. */
function WorkspaceSkeleton() {
  return (
    <Panel
      aria-busy
      className="flex min-h-0 flex-1 flex-col overflow-hidden xl:flex-row"
      style={{ "--sidebar-width": "280px" } as React.CSSProperties}
    >
      <div className="shrink-0 border-b border-hairline bg-surface p-2 xl:w-[var(--sidebar-width)] xl:border-b-0 xl:border-r">
        <Skeleton className="h-7 w-full rounded-full" />
        <div className="mt-3 space-y-2">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-2 max-w-40" />
          ))}
        </div>
      </div>
      <div className="min-h-[320px] flex-1" />
      <span className="sr-only">Loading pipelines</span>
    </Panel>
  );
}

/**
 * The editor's two panes inside one card: the library/variables rail and the
 * canvas, separated by a hairline and a keyboard-resizable grip.
 *
 * Below `xl` the rail stacks above the canvas rather than disappearing, so no
 * pipeline, node, or variable loses its click path on a narrow viewport.
 */
export function PipelineBuilderWorkspace({
  loading,
  sidebar,
  canvas,
  resize,
}: PipelineBuilderWorkspaceProps) {
  const handleResizeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") resize.resizeBy(-16);
    if (event.key === "ArrowRight") resize.resizeBy(16);
  };

  return (
    <PageBody className="flex flex-col">
      {loading ? (
        <WorkspaceSkeleton />
      ) : (
        <Panel
          className="flex min-h-0 flex-1 flex-col overflow-hidden xl:flex-row"
          style={{ "--sidebar-width": `${resize.width}px` } as React.CSSProperties}
        >
          {/* Stacked below `xl`, the rail is capped so the canvas keeps a
              usable share of the card instead of being pushed off it. */}
          {/* Secondary pane: bg-surface fill differentiates it from the working
              canvas — fill plus seam, not the seam alone. */}
          <div className="flex max-h-[38vh] min-h-0 shrink-0 flex-col border-b border-hairline bg-surface xl:max-h-none xl:w-[var(--sidebar-width)] xl:border-b-0 xl:border-r">
            <PipelineSidebar {...sidebar} />
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            tabIndex={0}
            onPointerDown={resize.startResize}
            onKeyDown={handleResizeKey}
            className="hidden w-1 shrink-0 cursor-col-resize self-stretch transition-colors duration-80 ease-standard hover:bg-accent-violet/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset xl:block"
          />
          <PipelineCanvas {...canvas} />
        </Panel>
      )}
    </PageBody>
  );
}
