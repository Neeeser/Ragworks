/**
 * Runs the shared facet-inference vectors (`tests/assets/facet_vectors.json`
 * at the repo root) — the same file the backend suite executes — so the two
 * facet-inference implementations cannot drift.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { facetIssues, inferPortFacets } from "../facet-inference";
import { modalityIssues } from "../modality";

import type { FacetEdge, FacetNodePorts, FacetPort } from "../facet-inference";

interface VectorPort {
  key: string;
  data_type: string;
  requires?: string[];
  accepts?: string[];
  unaccepted?: "passthrough" | "exclude";
  adds?: string[];
  preserves?: boolean;
  removes?: string[];
  required?: boolean;
  accepts_many?: boolean;
}

interface VectorCase {
  name: string;
  nodes: Record<string, { inputs: VectorPort[]; outputs: VectorPort[] }>;
  edges: Array<{
    id: string;
    source: string;
    source_port?: string;
    target: string;
    target_port?: string;
  }>;
  guarantees: Record<string, string[]>;
  potentials: Record<string, string[]>;
  issues: Array<{ edge_id: string; missing: string[] }>;
  modality: Array<{ kind: string; node_id: string; modality: string; severity: string }>;
}

// Vitest runs with cwd = frontend/, so the repo-root vectors live one level up.
const vectorsPath = path.resolve(process.cwd(), "..", "tests", "assets", "facet_vectors.json");
const vectors = JSON.parse(readFileSync(vectorsPath, "utf-8")) as { cases: VectorCase[] };

const toPorts = (ports: VectorPort[]): FacetPort[] =>
  ports.map((port) => ({
    key: port.key,
    data_type: port.data_type,
    requires: port.requires ?? [],
    accepts: port.accepts ?? [],
    unaccepted: port.unaccepted ?? "passthrough",
    adds: port.adds ?? [],
    preserves: port.preserves ?? false,
    removes: port.removes ?? [],
  }));

const toNodePorts = (nodes: VectorCase["nodes"]): FacetNodePorts =>
  new Map(
    Object.entries(nodes).map(([nodeId, decl]) => [
      nodeId,
      { inputs: toPorts(decl.inputs), outputs: toPorts(decl.outputs) },
    ]),
  );

const toEdges = (edges: VectorCase["edges"]): FacetEdge[] =>
  edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourcePort: edge.source_port,
    target: edge.target,
    targetPort: edge.target_port,
  }));

const byPort = (facets: ReadonlyMap<string, Set<string>>): Record<string, string[]> =>
  Object.fromEntries([...facets.entries()].map(([key, values]) => [key, [...values].sort()]));

describe("shared facet-inference vectors", () => {
  vectors.cases.forEach((testCase) => {
    it(testCase.name, () => {
      const nodePorts = toNodePorts(testCase.nodes);
      const edges = toEdges(testCase.edges);

      const inferred = inferPortFacets(nodePorts, edges);
      expect(byPort(inferred.guarantees)).toEqual(testCase.guarantees);
      expect(byPort(inferred.potentials)).toEqual(testCase.potentials);

      const issues = facetIssues(nodePorts, edges).map((issue) => ({
        edge_id: issue.edgeId,
        missing: issue.missing,
      }));
      expect(issues).toEqual(testCase.issues);

      const findings = modalityIssues(nodePorts, edges)
        .map((issue) => ({
          kind: issue.kind,
          node_id: issue.nodeId,
          modality: issue.modality,
          severity: issue.severity,
        }))
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.node_id.localeCompare(b.node_id));
      expect(findings).toEqual(testCase.modality);
    });
  });
});
