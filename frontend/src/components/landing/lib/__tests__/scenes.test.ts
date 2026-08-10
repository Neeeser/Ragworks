import { describe, expect, it } from "vitest";

import { LANDING_SCENES } from "@/components/landing/lib/scenes";
import { DEFAULT_PIPELINE_FIXTURE } from "@/components/pipelines/lib/default-pipeline-flow";

const HYBRID_SEARCH_ID = "hybrid-search";
const HYBRID_INGESTION_ID = "hybrid-ingestion";
const MULTIMODAL_ID = "multimodal-ingestion";
const PAGE_IMAGE_ID = "page-image-ingestion";
const DESCRIBED_ID = "described-image-ingestion";
const EMBEDDER_TYPE = "embedder.text";

/** Aggregates read one index and return numbers — a single straight run. */
const LINEAR_SCENE_IDS = new Set(["count-matches", "facet-by-source"]);

describe("LANDING_SCENES registry", () => {
  it("rotates through every shipped preset, both kinds included", () => {
    const ids = LANDING_SCENES.map((scene) => scene.id);
    expect(new Set(ids).size).toBe(ids.length); // ids unique
    expect(ids).toEqual(
      expect.arrayContaining([
        HYBRID_INGESTION_ID,
        HYBRID_SEARCH_ID,
        "reranked-search",
        "count-matches",
        "facet-by-source",
        MULTIMODAL_ID,
        PAGE_IMAGE_ID,
        DESCRIBED_ID,
      ]),
    );
    expect(LANDING_SCENES.some((scene) => scene.kind === "ingestion")).toBe(true);
    expect(LANDING_SCENES.some((scene) => scene.kind === "retrieval")).toBe(true);
    // The README capture prints these, so a blank one ships a headless scene.
    expect(LANDING_SCENES.every((scene) => scene.label.trim().length > 0)).toBe(true);
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
        if (family === "reranker") {
          expect(node.data.config.model_name, `${node.id} rerank model`).toBeTruthy();
        }
      });
    },
  );

  it("branching scenes fan out into a parallel stage; aggregates stay linear", () => {
    for (const scene of LANDING_SCENES) {
      const { steps } = scene.build();
      const hasParallelStage = steps.some((step) => step.nodeIds.length > 1);
      expect(hasParallelStage, scene.id).toBe(!LINEAR_SCENE_IDS.has(scene.id));
    }
  });

  it.each(
    LANDING_SCENES.filter((scene) =>
      DEFAULT_PIPELINE_FIXTURE.scenes.some((entry) => entry.id === scene.id),
    ).map((scene) => [scene.id] as const),
  )("builds %s directly from the generated definition", (sceneId) => {
    const scene = LANDING_SCENES.find((entry) => entry.id === sceneId);
    const generated = DEFAULT_PIPELINE_FIXTURE.scenes.find(
      (entry) => entry.id === sceneId,
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

  it("hybrid search fuses the semantic and BM25 branches with RRF", () => {
    const scene = LANDING_SCENES.find((entry) => entry.id === HYBRID_SEARCH_ID);
    expect(scene).toBeDefined();
    const { nodes, edges } = scene!.build();
    const fusion = nodes.find((node) => node.data.nodeType === "fusion.rrf");
    expect(fusion).toBeDefined();
    expect(edges.filter((edge) => edge.target === fusion!.id)).toHaveLength(2);
  });

  it("reranked search is hybrid search with the reranker ahead of the cut", () => {
    const hybrid = LANDING_SCENES.find((entry) => entry.id === HYBRID_SEARCH_ID)!.build();
    const reranked = LANDING_SCENES.find((entry) => entry.id === "reranked-search")!.build();
    const added = reranked.nodes
      .map((node) => node.data.nodeType)
      .filter((type) => !hybrid.nodes.some((node) => node.data.nodeType === type));
    expect(added).toEqual(["reranker.model"]);
  });

  it("the intake variants read images as well as text", () => {
    const multimodal = LANDING_SCENES.find((entry) => entry.id === MULTIMODAL_ID)!.build();
    const types = multimodal.nodes.map((node) => node.data.nodeType);
    expect(types).toContain("parse.text");
    expect(types).toContain("parse.media_file");
    expect(types).toContain("merge.items");

    const pageImages = LANDING_SCENES.find((entry) => entry.id === PAGE_IMAGE_ID)!.build();
    const imageTypes = pageImages.nodes.map((node) => node.data.nodeType);
    expect(imageTypes).toContain("parse.page_images");
    expect(imageTypes).toContain("image.resize");
    // Page renders carry no text, so the image intake wires no chunker.
    expect(imageTypes).not.toContain("chunker.token");
  });

  it("the described-image intake turns images into text before a text embedder", () => {
    const scene = LANDING_SCENES.find((entry) => entry.id === DESCRIBED_ID)!.build();
    const describe = scene.nodes.find((node) => node.data.nodeType === "llm.describe");
    expect(describe).toBeDefined();
    // The shell needs a model and the preset's prompt; either missing is a
    // node the product would refuse to save.
    expect(describe!.data.config.model_name).toBeTruthy();
    expect(describe!.data.config.prompt).toBeTruthy();
    expect(describe!.data.config.output_fields).toBeTruthy();

    const embedder = scene.nodes.find((node) => node.data.nodeType === EMBEDDER_TYPE)!;
    const bm25 = scene.nodes.find((node) => node.data.nodeType === "indexer.bm25")!;
    // Both indexes read the described stream, or an image indexed by its
    // description is absent from the lexical half of every hybrid ranking.
    [embedder.id, bm25.id].forEach((target) => {
      expect(
        scene.edges.some((edge) => edge.source === describe!.id && edge.target === target),
        `${target} reads the described stream`,
      ).toBe(true);
    });
  });

  it("an intake that embeds images names an image-capable embedding model", () => {
    const imageIntakes = [MULTIMODAL_ID, PAGE_IMAGE_ID];
    imageIntakes.forEach((id) => {
      const { nodes } = LANDING_SCENES.find((entry) => entry.id === id)!.build();
      const embedder = nodes.find((node) => node.data.nodeType === EMBEDDER_TYPE)!;
      expect(embedder.data.config.model_name, id).toBe("cohere/embed-v4.0");
    });
    // The described intake sends the embedder text, so it names a text model.
    const described = LANDING_SCENES.find((entry) => entry.id === DESCRIBED_ID)!.build();
    const embedder = described.nodes.find((node) => node.data.nodeType === EMBEDDER_TYPE)!;
    expect(embedder.data.config.model_name).toBe("openai/text-embedding-3-small");
  });

  it("keeps branch rows on distinct y positions so wires never hide behind cards", () => {
    const scene = LANDING_SCENES.find((entry) => entry.id === HYBRID_SEARCH_ID);
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
        sceneId: HYBRID_SEARCH_ID,
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
