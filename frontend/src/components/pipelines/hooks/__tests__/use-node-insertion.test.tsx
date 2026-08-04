import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

import * as apiModule from "@/lib/api";
import {
  makeCatalogModel,
  makeModelShortlist,
  makeNodeSpec,
  makeShortlistEntry,
} from "@/test/fixtures";

import { useNodeInsertion } from "../use-node-insertion";

import type { CatalogModel, NodeSpec } from "@/lib/types";

const api = vi.mocked(apiModule);

const CONNECTION_ID = "11111111-1111-4111-8111-111111111111";
const RECENT_MODEL = "recent-chat-model";

const chatModel: CatalogModel = makeCatalogModel({
  id: RECENT_MODEL,
  connection_id: CONNECTION_ID,
  supported_parameters: ["response_format"],
});

const transformSpec = (config: Record<string, unknown> = {}): NodeSpec =>
  makeNodeSpec({ type: "llm.transform", label: "Transform", default_config: config });

/** Mounts the hook and lets the shortlist request settle before returning. */
async function renderInsertion(llmModels: CatalogModel[] = [chatModel]) {
  const addNode = vi.fn();
  const hook = renderHook(() =>
    useNodeInsertion({
      catalogSpecs: [],
      reactFlowInstance: null,
      llmModels,
      hasRerankingProvider: true,
      rerankingProviderMessage: null,
      addNode,
      previewNodeSpec: vi.fn(),
      setMessage: vi.fn(),
    }),
  );
  // The shortlist request and the join against the catalog both have to land
  // before the seed exists; asserting earlier would pass vacuously.
  await act(async () => {});
  await act(async () => {});
  // Adding also clears the drop ghost, which is state — hence the act wrap.
  const add = (spec: NodeSpec) => act(() => hook.result.current.addNode(spec));
  return { addNode, add };
}

describe("useNodeInsertion", () => {
  beforeEach(() => {
    api.fetchModelShortlist.mockResolvedValue(
      makeModelShortlist({
        recent: [
          makeShortlistEntry({
            entry_type: "recent",
            connection_id: CONNECTION_ID,
            model_id: RECENT_MODEL,
          }),
        ],
      }),
    );
  });

  it("adds an LLM node carrying the most recently used chat model", async () => {
    const { addNode, add } = await renderInsertion();

    add(transformSpec());

    expect(addNode).toHaveBeenCalledWith(
      expect.objectContaining({
        default_config: { connection_id: CONNECTION_ID, model_name: RECENT_MODEL },
      }),
      undefined,
    );
  });

  it("leaves the model unset when the user has no recent chat model", async () => {
    api.fetchModelShortlist.mockResolvedValue(makeModelShortlist());
    const { addNode, add } = await renderInsertion();

    add(transformSpec());

    expect(addNode).toHaveBeenCalledWith(
      expect.objectContaining({ default_config: {} }),
      undefined,
    );
  });

  it("leaves the model unset when the recent one is no longer in the catalog", async () => {
    // A model the picker would refuse to offer is worse than an empty picker.
    const { addNode, add } = await renderInsertion([]);

    add(transformSpec());

    expect(addNode).toHaveBeenCalledWith(
      expect.objectContaining({ default_config: {} }),
      undefined,
    );
  });

  it("keeps the model a preset names for itself", async () => {
    const { addNode, add } = await renderInsertion();

    add(transformSpec({ connection_id: "other-connection", model_name: "preset-model" }));

    expect(addNode).toHaveBeenCalledWith(
      expect.objectContaining({
        default_config: { connection_id: "other-connection", model_name: "preset-model" },
      }),
      undefined,
    );
  });

  it("leaves a non-LLM node's config alone", async () => {
    const { addNode, add } = await renderInsertion();

    add(makeNodeSpec({ type: "chunker.token", default_config: {} }));

    expect(addNode).toHaveBeenCalledWith(
      expect.objectContaining({ default_config: {} }),
      undefined,
    );
  });
});
