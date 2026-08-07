"use client";

import { NodeToolbar, Position } from "@xyflow/react";
import { Pencil, Trash2 } from "lucide-react";

import { popoverSurfaceClass } from "@/components/ui/panel";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { usePipelineNodeActions } from "./flow/node-actions-context";

import type { LucideIcon } from "lucide-react";

// 32px square: the console's touch-target floor, which the toolbar has to
// clear because a canvas node is reachable on a phone too.
const actionClass =
  "flex h-8 w-8 items-center justify-center rounded-control text-muted transition-colors duration-80 ease-standard hover:bg-surface-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset";

type ToolbarActionProps = {
  icon: LucideIcon;
  label: string;
  tooltip: string;
  onClick: () => void;
  className?: string;
};

function ToolbarAction({ icon: Icon, label, tooltip, onClick, className }: ToolbarActionProps) {
  return (
    <Tooltip content={tooltip} side="top">
      <button
        type="button"
        aria-label={label}
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
 */
export function NodeSelectionToolbar({ nodeId }: { nodeId: string }) {
  const actions = usePipelineNodeActions();
  if (!actions) return null;

  return (
    <NodeToolbar nodeId={nodeId} position={Position.Top} offset={8} align="end">
      <div className={cn(popoverSurfaceClass, "flex items-center gap-0.5 p-1")}>
        <ToolbarAction
          icon={Pencil}
          label="Edit node"
          tooltip="Edit node · Enter"
          onClick={() => actions.editNode(nodeId)}
        />
        <ToolbarAction
          icon={Trash2}
          label="Delete node"
          tooltip="Delete node · Del"
          onClick={() => actions.deleteNode(nodeId)}
          className="hover:bg-data-neg/15 hover:text-data-neg"
        />
      </div>
    </NodeToolbar>
  );
}
