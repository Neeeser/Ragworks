/**
 * Flow: swapping a binding's index across backends, and the refusal that
 * guards it (scenario: backend-swap).
 *
 * 1. Log in via the API; find the registered Pinecone index alongside the
 *    pgvector ones.
 * 2. Point the second collection's search binding at Pinecone. A plain hybrid
 *    graph runs on either backend, so this must succeed — and it leaves the
 *    BM25 slot on pgvector, which is a genuinely cross-backend pipeline.
 * 3. Bind a facet pipeline (ParadeDB-only aggregation) and point it at
 *    Pinecone. That must be refused, naming the node, the backend it cannot
 *    run on, and the backend that would work.
 * 4. Unbind the facet pipeline so the seeded state is restored.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi, seededLink } from "../helpers";

interface IndexRead {
  name: string;
  backend: string;
  vector_type: string | null;
  registered: boolean;
  index_id: string | null;
}

const FACET_PIPELINE = (sparseIndexId: string, sparseIndexName: string) => ({
  name: "Facet by document (flow)",
  definition: {
    schema_version: 3,
    variables: [
      {
        name: "bm25_index",
        type: "index",
        source: "binding",
        description: "Lexical (BM25) index this pipeline uses",
        value: {
          index_id: sparseIndexId,
          backend: "pgvector",
          name: sparseIndexName,
        },
      },
    ],
    nodes: [
      {
        id: "in",
        type: "retrieval.input",
        name: "In",
        config: {
          tool_name: "facet_docs",
          tool_description: "Group matches by document.",
        },
      },
      {
        id: "facet",
        type: "facet.bm25",
        name: "Facet",
        config: {
          backend: { $expr: "bm25_index.backend" },
          index_name: { $expr: "bm25_index.name" },
          field: "document_id",
        },
      },
      { id: "out", type: "tool.output", name: "Out" },
    ],
    edges: [
      {
        id: "e1",
        source: "in",
        target: "facet",
        source_port: "request",
        target_port: "request",
      },
      {
        id: "e2",
        source: "facet",
        target: "out",
        source_port: "values",
        target_port: "values",
      },
    ],
  },
});

function collectionIdFrom(url: string): string {
  return new URL(url).pathname.split("/").pop() ?? "";
}

test("a binding swaps onto another backend, and an unsupported node is refused", async ({
  page,
}) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  const api = page.context().request;
  const headers = { Authorization: `Bearer ${handoff.token}` };
  const collectionId = collectionIdFrom(seededLink(handoff, "Second Collection overview"));

  const indexResponse = await api.get(`${handoff.backend_url}/api/indexes`, { headers });
  expect(indexResponse.ok()).toBe(true);
  const { indexes } = (await indexResponse.json()) as { indexes: IndexRead[] };

  const pinecone = indexes.find((index) => index.backend === "pinecone" && index.registered);
  const sparse = indexes.find(
    (index) =>
      index.vector_type === "sparse" && index.registered && index.name.startsWith("second"),
  );
  expect(pinecone?.index_id).toBeTruthy();
  expect(sparse?.index_id).toBeTruthy();

  const toolsResponse = await api.get(
    `${handoff.backend_url}/api/collections/${collectionId}/tools`,
    { headers },
  );
  const searchBinding = ((await toolsResponse.json()) as { tools: { id: string }[] }).tools[0];

  // A plain hybrid graph runs on either backend, so the swap is allowed —
  // and the BM25 slot stays on pgvector, spanning two stores.
  const swapped = await api.patch(
    `${handoff.backend_url}/api/collections/${collectionId}/tools/${searchBinding.id}`,
    {
      headers,
      data: {
        variable_values: {
          primary_index: {
            index_id: pinecone!.index_id,
            backend: "pinecone",
            name: pinecone!.name,
          },
        },
      },
    },
  );
  expect(swapped.status()).toBe(200);
  const swappedValues = (
    (await swapped.json()) as {
      variable_values: Record<string, { backend: string }>;
    }
  ).variable_values;
  expect(swappedValues.primary_index.backend).toBe("pinecone");
  expect(swappedValues.bm25_index.backend).toBe("pgvector");

  const pipelineResponse = await api.post(`${handoff.backend_url}/api/pipelines`, {
    headers,
    data: FACET_PIPELINE(sparse!.index_id!, sparse!.name),
  });
  expect(pipelineResponse.ok()).toBe(true);
  const pipeline = (await pipelineResponse.json()) as { id: string };

  const bindResponse = await api.post(
    `${handoff.backend_url}/api/collections/${collectionId}/tools`,
    { headers, data: { pipeline_id: pipeline.id } },
  );
  expect(bindResponse.ok()).toBe(true);
  const facetBinding = (await bindResponse.json()) as { id: string };

  try {
    // Pinecone has no query-conditioned aggregation, so facet cannot run there.
    const refused = await api.patch(
      `${handoff.backend_url}/api/collections/${collectionId}/tools/${facetBinding.id}`,
      {
        headers,
        data: {
          variable_values: {
            bm25_index: {
              index_id: pinecone!.index_id,
              backend: "pinecone",
              name: pinecone!.name,
            },
          },
        },
      },
    );

    expect(refused.status()).toBe(400);
    const { detail } = (await refused.json()) as { detail: string };
    // The message names the node, the backend, and what would work — a bare
    // "incompatible backend" would leave the user guessing which node to fix.
    expect(detail).toContain("facet");
    expect(detail).toContain("pinecone");
    expect(detail).toContain("pgvector");
  } finally {
    await api.delete(
      `${handoff.backend_url}/api/collections/${collectionId}/tools/${facetBinding.id}`,
      { headers },
    );
  }
});
