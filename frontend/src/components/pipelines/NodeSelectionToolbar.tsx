"use client";

import { NodeToolbar, Position } from "@xyflow/react";
import { Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { popoverSurfaceClass } from "@/components/ui/panel";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { usePipelineNodeActions } from "./flow/node-actions-context";

import type { LucideIcon } from "lucide-react";
import type { KeyboardEvent } from "react";

// 32px square: the console's touch-target floor, which the toolbar has to
// clear because a canvas node is reachable on a phone too.
const actionClass =
  "flex h-8 w-8 items-center justify-center rounded-control text-muted transition-colors duration-80 ease-standard hover:bg-surface-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset";

type ToolbarActionProps = {
  icon: LucideIcon;
  label: string;
  tooltip: string;
  onClick: () => void;
  /** Roving tab stop: only the active action is reachable with one Tab. */
  active: boolean;
  className?: string;
};

function ToolbarAction({
  icon: Icon,
  label,
  tooltip,
  onClick,
  active,
  className,
}: ToolbarActionProps) {
  return (
    <Tooltip content={tooltip} side="top">
      <button
        type="button"
        aria-label={label}
        tabIndex={active ? 0 : -1}
        onClick={onClick}
        className={cn(actionClass, className)}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </button>
    </Tooltip>
  );
}

/**
 * The actions on a selected node, floating above its card. Selecting a node
 * and editing it are separate acts, so this is what a single click reveals —
 * the inspector opens from Edit here, a double-click, or Enter.
 *
 * `NodeToolbar` positions in screen space rather than canvas space, so the
 * controls stay the same size at every zoom level. Rendered only where the
 * canvas supplies actions; a trace or landing graph gets no toolbar.
 *
 * A real `toolbar` with one tab stop and arrow-key travel between the
 * actions: the toolbar is portaled to the end of the canvas, so leaving two
 * plain buttons in document order would put them past every other node card
 * and reachable only by tabbing the whole graph. The canvas hands focus in
 * from the selected card, and Escape hands it back.
 */
export function NodeSelectionToolbar({ nodeId }: { nodeId: string }) {
  const actions = usePipelineNodeActions();
  const ref = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  if (!actions) return null;

  const focusCard = () => {
    document
      .querySelector<HTMLElement>(`.react-flow__node[data-id="${nodeId}"]`)
      ?.focus({ preventScroll: true });
  };

  const focusAction = (index: number) => {
    const buttons = Array.from(ref.current?.querySelectorAll("button") ?? []);
    if (buttons.length === 0) return;
    const next = (index + buttons.length) % buttons.length;
    setActiveIndex(next);
    buttons[next]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const count = ref.current?.querySelectorAll("button").length ?? 0;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusAction(activeIndex + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusAction(activeIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusAction(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusAction(count - 1);
    } else if (event.key === "Escape" || (event.key === "Tab" && event.shiftKey)) {
      // Escape leaves the actions and the selection they belong to; Shift+Tab
      // steps back to the card the toolbar was entered from, since document
      // order leads somewhere else entirely.
      event.preventDefault();
      event.stopPropagation();
      focusCard();
      setActiveIndex(0);
      if (event.key === "Escape") actions.deselectNode(nodeId);
    }
  };

  return (
    <NodeToolbar nodeId={nodeId} position={Position.Top} offset={8} align="end">
      <div
        ref={ref}
        role="toolbar"
        aria-label="Node actions"
        aria-orientation="horizontal"
        onKeyDown={handleKeyDown}
        className={cn(popoverSurfaceClass, "flex items-center gap-0.5 p-1")}
      >
        <ToolbarAction
          icon={Pencil}
          label="Edit node"
          tooltip="Edit node · Enter"
          active={activeIndex === 0}
          onClick={() => actions.editNode(nodeId)}
        />
        <ToolbarAction
          icon={Trash2}
          label="Delete node"
          tooltip="Delete node · Del"
          active={activeIndex === 1}
          onClick={() => actions.deleteNode(nodeId)}
          className="hover:bg-data-neg/15 hover:text-data-neg"
        />
      </div>
    </NodeToolbar>
  );
}
