import { routeSmartEdgesBatch } from "@tisoap/react-flow-smart-edge";

import type { RoutingSnapshot } from "./pipeline-edge-routing-controller";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RoutingSnapshot>) => void) | null;
  postMessage: (message: {
    version: number;
    results: ReturnType<typeof routeSmartEdgesBatch>;
  }) => void;
};

scope.onmessage = ({ data }) => {
  let results: ReturnType<typeof routeSmartEdgesBatch> = {};
  try {
    results = routeSmartEdgesBatch(data.input);
  } catch {
    // The main thread will keep native fallback paths for missing routes.
  }
  scope.postMessage({ version: data.version, results });
};
