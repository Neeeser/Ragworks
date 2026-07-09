"use client";

import { addEdge } from "@xyflow/react";
import { useCallback, useState } from "react";

import { validatePipelineConnection } from "../lib/pipeline-io";
import { createId } from "../lib/pipeline-utils";

import type { TypedEdgeType } from "../flow/TypedEdge";
import type { ConnectingContext, PipelineNodeData } from "../PipelineNode";
import type { Connection, Edge, Node, OnConnectStartParams } from "@xyflow/react";

type UseConnectionTypingParams = {
  nodes: Node<PipelineNodeData>[];
  setEdges: (updater: (edges: TypedEdgeType[]) => TypedEdgeType[]) => void;
  onInvalidConnection: (reason: string) => void;
};

type UseConnectionTypingResult = {
  /** Live wire-drag context; nodes use it to highlight compatible ports. */
  connecting: ConnectingContext | null;
  validateConnection: (connection: Connection | Edge) => { valid: boolean; reason?: string };
  handleConnect: (connection: Connection) => void;
  handleConnectStart: (event: unknown, params: OnConnectStartParams) => void;
  handleConnectEnd: () => void;
};

/**
 * Owns typed connection state: validates wires against port data types, adds
 * valid edges colored by the data type they carry, and tracks the in-flight
 * drag so the canvas can light up compatible handles and dim the rest.
 */
export function useConnectionTyping({
  nodes,
  setEdges,
  onInvalidConnection,
}: UseConnectionTypingParams): UseConnectionTypingResult {
  const [connecting, setConnecting] = useState<ConnectingContext | null>(null);

  const validateConnection = useCallback(
    (connection: Connection | Edge) => validatePipelineConnection(connection, nodes),
    [nodes],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      setConnecting(null);
      const validation = validateConnection(connection);
      if (!validation.valid) {
        onInvalidConnection(validation.reason ?? "Invalid connection.");
        return;
      }
      setEdges((prev) => {
        const sourceNode = nodes.find((node) => node.id === connection.source);
        const dataType = sourceNode?.data.outputs.find(
          (port) => port.key === connection.sourceHandle,
        )?.data_type;
        return addEdge<TypedEdgeType>(
          { ...connection, id: createId(), type: "typed", data: { dataType } },
          prev,
        );
      });
    },
    [nodes, setEdges, validateConnection, onInvalidConnection],
  );

  const handleConnectStart = useCallback(
    (_event: unknown, params: OnConnectStartParams) => {
      if (!params.nodeId || !params.handleId || !params.handleType) return;
      const node = nodes.find((entry) => entry.id === params.nodeId);
      if (!node) return;
      const ports = params.handleType === "source" ? node.data.outputs : node.data.inputs;
      const dataType = ports.find((port) => port.key === params.handleId)?.data_type;
      if (!dataType) return;
      setConnecting({ dataType, from: params.handleType, nodeId: params.nodeId });
    },
    [nodes],
  );

  const handleConnectEnd = useCallback(() => setConnecting(null), []);

  return { connecting, validateConnection, handleConnect, handleConnectStart, handleConnectEnd };
}
