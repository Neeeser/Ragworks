/**
 * Flow: a node the backend cannot run is refused when the pipeline is saved
 * (scenario: backend-swap).
 *
 * 1. Log in via the API; find the registered Pinecone indexes alongside the
 *    pgvector ones.
 * 2. Save a facet pipeline (ParadeDB-only aggregation) naming the *sparse*
 *    Pinecone index. That must be refused, naming the node, the backend it
 *    cannot run on, and the backend that would work. Sparse, not dense: a
 *    lexical node reading a dense index is a different mistake, caught by a
 *    different guard.
 *
 * The check runs at save time because a node names its own index, so "can this
 * graph run?" has one answer for every collection that binds it.
 */
import { expect, test } from "@playwright/test";

import { loadHandoff, loginViaApi } from "../helpers";

interface IndexRead {
  name: string;
  backend: string;
  vector_type: string | null;
  registered: boolean;
  index_id: string | null;
}

const FACET_PIPELINE = (indexName: string) => ({
  name: `Facet by document (flow ${Date.now()})`,
  definition: {
    schema_version: 3,
    variables: [],
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
        config: { backend: "pinecone", index_name: indexName, field: "document_id" },
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

test("an unsupported node is refused when the pipeline is saved", async ({ page }) => {
  const handoff = loadHandoff();
  await loginViaApi(page);
  const api = page.context().request;
  const headers = { Authorization: `Bearer ${handoff.token}` };

  const indexResponse = await api.get(`${handoff.backend_url}/api/indexes`, { headers });
  expect(indexResponse.ok()).toBe(true);
  const { indexes } = (await indexResponse.json()) as { indexes: IndexRead[] };

  const pineconeSparse = indexes.find(
    (index) => index.backend === "pinecone" && index.registered && index.vector_type === "sparse",
  );
  expect(pineconeSparse?.name).toBeTruthy();

  // Pinecone has no query-conditioned aggregation, so facet cannot run there.
  const refused = await api.post(`${handoff.backend_url}/api/pipelines`, {
    headers,
    data: FACET_PIPELINE(pineconeSparse!.name),
  });

  expect(refused.status()).toBe(400);
  const detail = JSON.stringify((await refused.json()).detail);
  // The message names the node, the backend, and what would work — a bare
  // "incompatible backend" would leave the user guessing which node to fix.
  expect(detail).toContain("facet");
  expect(detail).toContain("pinecone");
  expect(detail).toContain("pgvector");
});
