// Wire types for collection insights, hand-mirrored from app/schemas/insights.py.

import type { UUID } from "./common";

export type InsightSpace = "semantic" | "lexical";

export type InsightStatus = "computing" | "ready" | "failed";

export interface InsightSnapshot {
  id: UUID;
  collection_id: UUID;
  space: InsightSpace;
  space_label: string;
  status: InsightStatus;
  error_message: string | null;
  point_count: number;
  document_count: number;
  cluster_count: number;
  coverage: number;
  transformed_count: number;
  deleted_count: number;
  fitted_count: number;
  created_at: string;
  updated_at: string;
}

export interface InsightOverview {
  snapshot: InsightSnapshot | null;
  active: InsightSnapshot | null;
  chunk_total: number;
  can_compute: boolean;
}

export interface InsightPoint {
  id: UUID;
  chunk_id: UUID;
  document_id: UUID;
  document_name: string;
  chunk_index: number;
  x: number;
  y: number;
  cluster_index: number | null;
}

export interface InsightDocPoint {
  document_id: UUID;
  document_name: string;
  x: number;
  y: number;
  chunk_count: number;
}

export interface InsightCluster {
  cluster_index: number;
  label: string;
  size: number;
  x: number;
  y: number;
}

export interface InsightMap {
  snapshot: InsightSnapshot;
  points: InsightPoint[];
  documents: InsightDocPoint[];
  clusters: InsightCluster[];
}

export interface InsightDocEdge {
  source_document_id: UUID;
  target_document_id: UUID;
  similarity: number;
  collision_count: number;
}

export interface InsightGraph {
  snapshot: InsightSnapshot;
  documents: InsightDocPoint[];
  edges: InsightDocEdge[];
}

export interface OverlapSide {
  chunk_id: UUID;
  document_id: UUID;
  document_name: string;
  chunk_index: number;
  text_snippet: string;
}

export interface InsightOverlap {
  similarity: number;
  a: OverlapSide;
  b: OverlapSide;
}

export interface InsightOverlaps {
  snapshot: InsightSnapshot;
  pairs: InsightOverlap[];
  total: number;
  offset: number;
}

export interface InsightProbeMatch {
  chunk_id: UUID;
  document_id: UUID;
  document_name: string;
  chunk_index: number;
  similarity: number;
  text_snippet: string;
}

export interface InsightProbeResult {
  x: number;
  y: number;
  space: InsightSpace;
  space_label: string;
  matches: InsightProbeMatch[];
}
