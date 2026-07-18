import { describe, expect, it } from "vitest";

import { LANDING_SCENES } from "@/components/landing/lib/scenes";
import { DEFAULT_PIPELINE_FIXTURE } from "@/components/pipelines/lib/default-pipeline-flow";

const HYBRID_RETRIEVAL_ID = "hybrid-retrieval";
const HYBRID_INGESTION_ID = "hybrid-ingestion";

describe("LANDING_SCENES registry", () => {
  it("ships both semantic and hybrid variants of ingestion and retrieval", () => {
    const ids = LANDING_SCENES.map((scene) => scene.id);
    expect(new Set(ids).size).toBe(ids.length); // ids unique
    expect(ids).toContain("semantic-ingestion");
    expect(ids).toContain("semantic-retrieval");
    expect(ids).toContain(HYBRID_INGESTION_ID);
    expect(ids).toContain(HYBRID_RETRIEVAL_ID);
    expect(LANDING_SCENES.some((scene) => scene.kind === "ingestion")).toBe(true);
    expect(LANDING_SCENES.some((scene) => scene.kind === "retrieval")).toBe(true);
  });

  // The guard that keeps future scene additions honest: every scene must
  // build a self-consistent graph or playback silently stalls/misdraws.
  it.each(LANDING_SCENES.map((scene) => [scene.id, scene] as const))(
    "scene %s builds a self-consistent graph",
    (_id, scene) => {
      const { nodes, edges, steps } = scene.build();
      const nodeIds = new Set(nodes.map((node) => node.id));

      expect(nodes.length).toBeGreaterThan(2);
      expect(steps.length).toBeGreaterThan(2);

      // Every edge endpoint is a real node, wired to real ports, typed for color.
      const byId = new Map(nodes.map((node) => [node.id, node]));
      edges.forEach((edge) => {
        expect(nodeIds.has(edge.source), `edge source ${edge.source}`).toBe(true);
        expect(nodeIds.has(edge.target), `edge target ${edge.target}`).toBe(true);
        expect(edge.type).toBe("typed");
        expect(edge.data?.dataType).toBeTruthy();
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        expect(source?.data.outputs.some((port) => port.key === edge.sourceHandle)).toBe(true);
        expect(target?.data.inputs.some((port) => port.key === edge.targetHandle)).toBe(true);
      });

      // Every stage references real nodes, and every node appears in a stage.
      const staged = new Set<string>();
      steps.forEach((step) => {
        expect(step.nodeIds.length).toBeGreaterThan(0);
        step.nodeIds.forEach((id) => {
          expect(nodeIds.has(id), `stage node ${id}`).toBe(true);
          staged.add(id);
        });
      });
      expect([...nodeIds].filter((id) => !staged.has(id))).toEqual([]);

      // Consecutive stages are connected: at least one edge departs each hop
      // (mirrors the playback engine's rule — source finishes this stage,
      // target lies anywhere downstream).
      for (let i = 0; i < steps.length - 1; i += 1) {
        const from = new Set(steps[i].nodeIds);
        const next = new Set(steps[i + 1].nodeIds);
        const downstream = new Set(steps.slice(i + 1).flatMap((step) => step.nodeIds));
        const hop = edges.some(
          (edge) => from.has(edge.source) && !next.has(edge.source) && downstream.has(edge.target),
        );
        expect(hop, `no edge departs stage ${i} → ${i + 1}`).toBe(true);
      }

      // No node shows an unset "no model/index selected" placeholder: every
      // embedder carries a model and every indexer/retriever an index name.
      nodes.forEach((node) => {
        const family = node.data.nodeType.split(".")[0];
        if (family === "embedder") {
          expect(node.data.config.model_name, `${node.id} model`).toBeTruthy();
        }
        if (family === "indexer" || family === "retriever") {
          expect(node.data.config.index_name, `${node.id} index`).toBeTruthy();
        }
        if (family === "chunker") {
          expect(node.data.config.chunk_size, `${node.id} chunk size`).toBeTruthy();
        }
      });
    },
  );

  it("hybrid scenes fan out into a parallel stage; semantic scenes stay linear", () => {
    for (const scene of LANDING_SCENES) {
      const { steps } = scene.build();
      const hasParallelStage = steps.some((step) => step.nodeIds.length > 1);
      expect(hasParallelStage, scene.id).toBe(scene.id.startsWith("hybrid"));
    }
  });

  it.each([
    [HYBRID_INGESTION_ID, "ingestion"],
    [HYBRID_RETRIEVAL_ID, "retrieval"],
  ] as const)("builds %s directly from the generated default definition", (sceneId, kind) => {
    const scene = LANDING_SCENES.find((entry) => entry.id === sceneId);
    const generated = DEFAULT_PIPELINE_FIXTURE.scenes.find(
      (entry) => entry.kind === kind,
    )?.definition;
    expect(scene).toBeDefined();
    expect(generated).toBeDefined();

    const flow = scene!.build();
    expect(flow.nodes.map((node) => node.id).sort()).toEqual(
      generated!.nodes.map((node) => node.id).sort(),
    );
    expect(flow.edges.map((edge) => edge.id).sort()).toEqual(
      generated!.edges.map((edge) => edge.id).sort(),
    );
  });

  it("hybrid ingestion splits at the chunker and merges both indexes downstream", () => {
    const scene = LANDING_SCENES.find((entry) => entry.id === HYBRID_INGESTION_ID);
    expect(scene).toBeDefined();
    const { edges } = scene!.build();
    const fanOut = edges.filter((edge) => edge.source === "chunk-document");
    expect(fanOut).toHaveLength(2);
    const mergeTargets = new Map<string, number>();
    edges.forEach((edge) =>
      mergeTargets.set(edge.target, (mergeTargets.get(edge.target) ?? 0) + 1),
    );
    expect([...mergeTargets.values()].some((count) => count >= 2)).toBe(true);
  });

  it("hybrid retrieval fuses the semantic and BM25 branches with RRF", () => {
    const scene = LANDING_SCENES.find((entry) => entry.id === HYBRID_RETRIEVAL_ID);
    expect(scene).toBeDefined();
    const { nodes, edges } = scene!.build();
    const fusion = nodes.find((node) => node.data.nodeType === "fusion.rrf");
    expect(fusion).toBeDefined();
    expect(edges.filter((edge) => edge.target === fusion!.id)).toHaveLength(2);
  });

  it("keeps branch rows on distinct y positions so wires never hide behind cards", () => {
    const scene = LANDING_SCENES.find((entry) => entry.id === HYBRID_RETRIEVAL_ID);
    const { nodes } = scene!.build();
    const rows = new Set(nodes.map((node) => node.position.y));
    expect(rows.size).toBeGreaterThan(1);
  });

  // Scenes are placed by the shared auto-layout (the editor's Tidy
  // algorithm), so merge nodes must sit between their branches — the
  // regression the manual grid used to hand-maintain.
  it("auto-layout centers hybrid merge nodes between their branch rows", () => {
    const cases = [
      {
        sceneId: HYBRID_INGESTION_ID,
        branches: ["index-chunks", "index-bm25"],
        merge: "ingest-output",
      },
      {
        sceneId: HYBRID_RETRIEVAL_ID,
        branches: ["vector-retriever", "bm25-retriever"],
        merge: "fuse-results",
      },
    ];
    cases.forEach(({ sceneId, branches, merge }) => {
      const scene = LANDING_SCENES.find((entry) => entry.id === sceneId);
      const { nodes } = scene!.build();
      const byId = new Map(nodes.map((node) => [node.id, node]));
      const branchYs = branches.map((id) => byId.get(id)!.position.y);
      const mergeY = byId.get(merge)!.position.y;
      expect(mergeY, `${sceneId} merge above branches`).toBeGreaterThan(Math.min(...branchYs));
      expect(mergeY, `${sceneId} merge below branches`).toBeLessThan(Math.max(...branchYs));
    });
  });
});
