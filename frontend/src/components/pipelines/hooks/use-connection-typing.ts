"use client";

import { addEdge } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  cycleFeedback,
  plainRefusalFeedback,
  refusedConnectionFeedback,
  replacedConnectionFeedback,
} from "../lib/connection-feedback";
import { facetsToken, inferOutputFacets } from "../lib/facet-inference";
import { findGraphCycles } from "../lib/graph-cycles";
import { connectionTargets, validatePipelineConnection } from "../lib/pipeline-io";
import { createId } from "../lib/pipeline-utils";

import type { TypedEdgeType } from "../flow/TypedEdge";
import type { ConnectionFeedback } from "../lib/connection-feedback";
import type { ConnectingContext, PipelineConnectionValidation } from "../lib/pipeline-io";
import type { PipelineNodeData } from "../PipelineNode";
import type {
  Connection,
  Edge,
  FinalConnectionState,
  Node,
  OnConnectStartParams,
} from "@xyflow/react";

type UseConnectionTypingParams = {
  nodes: Node<PipelineNodeData>[];
  edges: TypedEdgeType[];
  setEdges: (updater: (edges: TypedEdgeType[]) => TypedEdgeType[]) => void;
  /** Where a refusal, replacement, or new loop is told to the user. */
  onFeedback: (feedback: ConnectionFeedback, at: { x: number; y: number } | null) => void;
};

type UseConnectionTypingResult = {
  /** Live wire-drag context; nodes use it to highlight compatible ports. */
  connecting: ConnectingContext | null;
  validateConnection: (connection: Connection | Edge) => PipelineConnectionValidation;
  handleConnect: (connection: Connection) => void;
  handleConnectStart: (event: unknown, params: OnConnectStartParams) => void;
  handleConnectEnd: (event: MouseEvent | TouchEvent, state: FinalConnectionState) => void;
};

const inferGuarantees = (nodes: Node<PipelineNodeData>[], edges: TypedEdgeType[]) =>
  inferOutputFacets(
    new Map(
      nodes.map((node) => [node.id, { inputs: node.data.inputs, outputs: node.data.outputs }]),
    ),
    edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourcePort: edge.sourceHandle,
      target: edge.target,
      targetPort: edge.targetHandle,
    })),
  );

/** Where a drag ended, in viewport coordinates, for positioning its message. */
const pointerAt = (event: MouseEvent | TouchEvent): { x: number; y: number } | null => {
  if ("clientX" in event) return { x: event.clientX, y: event.clientY };
  const touch = event.changedTouches?.[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
};

const nodeName = (nodes: Node<PipelineNodeData>[], id: string | null | undefined): string =>
  nodes.find((node) => node.id === id)?.data.label ?? "another node";

/**
 * Owns typed connection state: validates wires against port data types and
 * facets, adds valid edges colored by the data type they carry, tracks the
 * in-flight drag so the canvas can light up the handles it may land on, and
 * tells the user what happened when a drop is refused, replaces a wire, or
 * closes a loop.
 *
 * The refusal is reported from `onConnectEnd`, not `onConnect`: xyflow never
 * calls `onConnect` for a connection `isValidConnection` rejected, so a refusal
 * reported there is a refusal nobody ever sees.
 */
export function useConnectionTyping({
  nodes,
  edges,
  setEdges,
  onFeedback,
}: UseConnectionTypingParams): UseConnectionTypingResult {
  const [connecting, setConnecting] = useState<ConnectingContext | null>(null);
  // Where the pointer is, tracked only while a wire is in flight. `onConnect`
  // carries no event, so a replacement or a new loop would otherwise be
  // reported in the middle of the canvas while a refusal appears under the
  // cursor — one interaction answering in two different places.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!connecting) return;
    const track = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener("pointermove", track, { passive: true });
    return () => window.removeEventListener("pointermove", track);
  }, [connecting]);

  const validateConnection = useCallback(
    (connection: Connection | Edge) =>
      validatePipelineConnection(connection, nodes, undefined, edges),
    [nodes, edges],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      setConnecting(null);
      const validation = validateConnection(connection);
      /* c8 ignore next 4 -- xyflow gates on isValidConnection first; the
         refusal path a user reaches is handleConnectEnd's. */
      if (!validation.valid) {
        onFeedback(
          plainRefusalFeedback(validation.reason ?? "Invalid connection."),
          pointerRef.current,
        );
        return;
      }
      // Dropping on an occupied single-connection input replaces what is
      // already there — the removal rides in the same edit, so the editor's
      // unsaved-changes diff reports the disconnect the user just caused.
      const replaced = new Set(validation.replaces ?? []);
      const displaced = edges.find((edge) => replaced.has(edge.id));
      setEdges((prev) => {
        const kept = replaced.size > 0 ? prev.filter((edge) => !replaced.has(edge.id)) : prev;
        const sourceNode = nodes.find((node) => node.id === connection.source);
        const port = sourceNode?.data.outputs.find(
          (entry) => entry.key === connection.sourceHandle,
        );
        const dataType = port
          ? facetsToken(
              port.data_type,
              inferGuarantees(nodes, kept).get(`${connection.source}.${port.key}`) ??
                port.adds ??
                [],
            )
          : undefined;
        return addEdge<TypedEdgeType>(
          { ...connection, id: createId(), type: "typed", data: { dataType } },
          kept,
        );
      });

      // A loop is reported the moment it closes rather than at save, and named
      // by the path it runs around.
      const nextEdges = [
        ...edges.filter((edge) => !replaced.has(edge.id)),
        { id: "pending", source: connection.source, target: connection.target },
      ];
      const cycles = findGraphCycles(nextEdges);
      const loop = cycles.paths.find((path) => path.includes(connection.target));
      const at = pointerRef.current;
      if (loop) {
        onFeedback(cycleFeedback(loop.map((nodeId) => nodeName(nodes, nodeId))), at);
      } else if (displaced) {
        onFeedback(replacedConnectionFeedback(nodeName(nodes, displaced.source)), at);
      }
    },
    [nodes, edges, setEdges, validateConnection, onFeedback],
  );

  const handleConnectStart = useCallback(
    (_event: unknown, params: OnConnectStartParams) => {
      if (!params.nodeId || !params.handleId || !params.handleType) return;
      setConnecting({
        from: params.handleType,
        nodeId: params.nodeId,
        ...connectionTargets(nodes, edges, {
          nodeId: params.nodeId,
          portKey: params.handleId,
          from: params.handleType,
        }),
      });
    },
    [nodes, edges],
  );

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      setConnecting(null);
      pointerRef.current = null;
      // Dropped on empty canvas, or on the handle it came from: nothing was
      // refused, so there is nothing to say.
      const { fromHandle, toHandle } = state;
      if (!fromHandle?.nodeId || !toHandle?.nodeId) return;
      const connection: Connection =
        fromHandle.type === "source"
          ? {
              source: fromHandle.nodeId,
              sourceHandle: fromHandle.id ?? null,
              target: toHandle.nodeId,
              targetHandle: toHandle.id ?? null,
            }
          : {
              source: toHandle.nodeId,
              sourceHandle: toHandle.id ?? null,
              target: fromHandle.nodeId,
              targetHandle: fromHandle.id ?? null,
            };
      const validation = validateConnection(connection);
      if (validation.valid) return;

      const sourcePort = nodes
        .find((node) => node.id === connection.source)
        ?.data.outputs.find((port) => port.key === connection.sourceHandle);
      const targetPort = nodes
        .find((node) => node.id === connection.target)
        ?.data.inputs.find((port) => port.key === connection.targetHandle);
      onFeedback(
        sourcePort && targetPort
          ? refusedConnectionFeedback(sourcePort, targetPort, validation.missing ?? [])
          : plainRefusalFeedback(validation.reason ?? "This connection is not possible."),
        pointerAt(event),
      );
    },
    [nodes, validateConnection, onFeedback],
  );

  return { connecting, validateConnection, handleConnect, handleConnectStart, handleConnectEnd };
}
