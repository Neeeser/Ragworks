import { apiFetch } from "./client";

import type {
  InsightGraph,
  InsightMap,
  InsightOverlaps,
  InsightOverview,
  InsightProbeResult,
} from "@/lib/types";

export async function fetchInsightOverview(
  token: string,
  collectionId: string,
): Promise<InsightOverview> {
  return apiFetch<InsightOverview>(`/api/collections/${collectionId}/insights`, { token });
}

export async function refreshInsights(
  token: string,
  collectionId: string,
): Promise<InsightOverview> {
  return apiFetch<InsightOverview>(`/api/collections/${collectionId}/insights/refresh`, {
    method: "POST",
    token,
  });
}

export async function fetchInsightMap(token: string, collectionId: string): Promise<InsightMap> {
  return apiFetch<InsightMap>(`/api/collections/${collectionId}/insights/map`, { token });
}

export async function fetchInsightGraph(
  token: string,
  collectionId: string,
): Promise<InsightGraph> {
  return apiFetch<InsightGraph>(`/api/collections/${collectionId}/insights/graph`, { token });
}

export async function fetchInsightOverlaps(
  token: string,
  collectionId: string,
  limit = 50,
): Promise<InsightOverlaps> {
  return apiFetch<InsightOverlaps>(
    `/api/collections/${collectionId}/insights/overlaps?limit=${limit}`,
    { token },
  );
}

export async function probeInsights(
  token: string,
  collectionId: string,
  query: string,
): Promise<InsightProbeResult> {
  return apiFetch<InsightProbeResult>(`/api/collections/${collectionId}/insights/probe`, {
    method: "POST",
    token,
    body: JSON.stringify({ query }),
  });
}
