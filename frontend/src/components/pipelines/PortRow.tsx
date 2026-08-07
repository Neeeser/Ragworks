"use client";

import { Handle, Position } from "@xyflow/react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { portToken } from "./lib/facet-inference";
import { getPortTypeClasses } from "./lib/pipeline-theme";
import {
  portAcceptsMany,
  portIsRequired,
  portRoleName,
  portTooltip,
  portTypeName,
} from "./lib/port-vocabulary";

import type { ConnectingContext } from "./lib/pipeline-io";
import type { NodeSpec } from "@/lib/types";

/**
 * Below this zoom the secondary role line is dropped: the type name is the
 * signal that must survive, and two 11px lines at a quarter scale are a smudge
 * rather than a label.
 */
export const ROLE_LABEL_MIN_ZOOM = 0.6;

/** Required input. Explained in the canvas legend, named in the tooltip. */
const REQUIRED_MARK = "∗";
/** Fan-in input: any number of edges may land here. */
const MANY_MARK = "+";

type PortRowProps = {
  port: NodeSpec["input_ports"][number];
  side: "input" | "output";
  connecting?: ConnectingContext | null;
  nodeId: string;
  connectable: boolean;
  /** False at low zoom, where the secondary role line stops being legible. */
  showRole: boolean;
};

/**
 * One port row: its canonical type name, its node-local role beneath when that
 * says something the type does not, and the xyflow Handle anchored on the card
 * edge at the row's height.
 *
 * The type name is rendered, never only implied by the dot's color — colour
 * alone cannot be read by everyone and cannot be read at all mid-drag, which
 * is exactly when a user is deciding where a wire may land. A variadic input
 * (accepts_many) keeps its stacked socket so fan-in ports read differently
 * from single-edge ones at a glance.
 *
 * While a wire is dragged, compatible handles swell and pulse, handles whose
 * port is already occupied warn amber, and incompatible ones fade.
 */
export function PortRow({ port, side, connecting, nodeId, connectable, showRole }: PortRowProps) {
  const isTargetSide = side === "input";
  const token = portToken(port, side);
  const portClasses = getPortTypeClasses(token);
  const typeName = portTypeName(port, side);
  const roleName = portRoleName(port, side);
  const acceptsMany = portAcceptsMany(port, side);
  const required = portIsRequired(port, side);

  const portRef = `${nodeId}.${port.key}`;
  const compatible = Boolean(connecting?.valid.has(portRef));
  const replaces = Boolean(connecting?.replaces.has(portRef));
  const incompatible = Boolean(connecting) && !compatible;

  const marks = `${required ? REQUIRED_MARK : ""}${acceptsMany ? MANY_MARK : ""}`;

  return (
    <Tooltip
      content={portTooltip(port, side)}
      side="top"
      triggerElement="div"
      triggerClassName="w-full min-w-0"
    >
      <div
        className={cn(
          // w-full matters: the tooltip trigger is inline-flex, so without it
          // this row shrinks to its label and the edge-anchored handles anchor
          // to the text instead of the card edge.
          "relative flex w-full min-w-0 items-center gap-1.5 py-0.5 text-instrument leading-4",
          isTargetSide ? "justify-start" : "justify-end",
          incompatible && "opacity-40",
        )}
      >
        {isTargetSide ? (
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", portClasses.dot)} />
        ) : null}
        <span
          aria-label={portTooltip(port, side)}
          className={cn("flex min-w-0 flex-col", isTargetSide ? "items-start" : "items-end")}
        >
          <span className="flex min-w-0 max-w-full items-baseline gap-0.5">
            <span className="truncate text-body">{typeName}</span>
            {marks ? (
              <span aria-hidden className="shrink-0 font-mono text-meta">
                {marks}
              </span>
            ) : null}
          </span>
          {roleName && showRole ? (
            <span className="w-full truncate text-meta" style={{ lineHeight: "0.95rem" }}>
              {roleName}
            </span>
          ) : null}
        </span>
        {!isTargetSide ? (
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", portClasses.dot)} />
        ) : null}
        {acceptsMany ? (
          <>
            <span
              data-socket="stacked"
              aria-hidden
              className={cn(
                "pointer-events-none absolute left-[-15px] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 bg-canvas-raised opacity-40",
                portClasses.ring,
              )}
            />
            <span
              data-socket="stacked"
              aria-hidden
              className={cn(
                "pointer-events-none absolute left-[-11px] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 bg-canvas-raised opacity-70",
                portClasses.ring,
              )}
            />
          </>
        ) : null}
        <Handle
          type={isTargetSide ? "target" : "source"}
          position={isTargetSide ? Position.Left : Position.Right}
          id={port.key}
          isConnectable={connectable}
          data-socket={acceptsMany ? "stacked" : undefined}
          className={cn(
            // transform-none! cancels xyflow's translate(±50%, -50%) — Tailwind
            // v4 translates via the `translate` property, so without it the two
            // stack and shift the handle 6px off its anchor.
            "absolute! top-1/2! h-3! w-3! transform-none! -translate-y-1/2! rounded-full! border-2! border-canvas-raised! transition-all!",
            portClasses.handle,
            isTargetSide ? "-left-[19px]!" : "-right-[19px]!",
            compatible && "h-4! w-4! animate-pulse ring-2! ring-accent-cyan/70!",
            // An occupied single-connection input is a legal drop that costs
            // the user the wire already there, so it reads as a warning rather
            // than as an ordinary target.
            replaces && "ring-2! ring-data-warn! animate-none!",
            incompatible && "opacity-30!",
          )}
        />
      </div>
    </Tooltip>
  );
}
