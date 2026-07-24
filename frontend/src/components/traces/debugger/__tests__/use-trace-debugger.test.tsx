import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useTraceDebugger } from "@/components/traces/debugger/hooks/use-trace-debugger";
import * as apiModule from "@/lib/api";
import { makeNodeRunTrace, makeTraceResponse } from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () =>
  // Inline literal: vi.mock factories are hoisted above const initializers.
  (await import("@/test/mocks")).mockAuth({ token: "test-token" }),
);

const TEST_TOKEN = "test-token";
const ROUTE_CHUNK_ID = "route-chunk";

const api = vi.mocked(apiModule);

describe("useTraceDebugger", () => {
  it("loads a query-event trace and builds its graph", async () => {
    const { result } = renderHook(() =>
      useTraceDebugger({ kind: "query", id: "qe-1", chunkId: null }),
    );

    await waitFor(() => expect(result.current.graph).not.toBeNull());
    expect(api.fetchQueryEventTrace).toHaveBeenCalledWith(TEST_TOKEN, "qe-1");
    expect(result.current.graph?.combined).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("loads the end-to-end trace when a chunk is targeted", async () => {
    api.fetchQueryEventEndToEndTrace.mockResolvedValueOnce({
      retrieval: makeTraceResponse(),
      context_items: [],
      origin: {
        document_id: "doc-1",
        document_name: "doc.pdf",
        chunk_id: "chunk-1",
        trace: makeTraceResponse({
          run: { ...makeTraceResponse().run, id: "run-origin", trigger: "ingest" },
          node_runs: [makeNodeRunTrace({ id: "nr-origin", node_id: "origin-node" })],
        }),
      },
    });

    const { result } = renderHook(() =>
      useTraceDebugger({ kind: "query", id: "qe-1", chunkId: "chunk-1" }),
    );

    await waitFor(() => expect(result.current.graph).not.toBeNull());
    expect(api.fetchQueryEventEndToEndTrace).toHaveBeenCalledWith(TEST_TOKEN, "qe-1", "chunk-1");
    expect(result.current.graph?.combined).toBe(true);
    expect(result.current.focusedItemId).toBe("chunk-1");
  });

  it("resolves the focused chunk when a document trace targets one", async () => {
    api.fetchDocumentFocusedTrace.mockResolvedValueOnce({
      trace: makeTraceResponse({
        run: { ...makeTraceResponse().run, trigger: "ingest" },
      }),
      focused_item: {
        id: "doc-1:7",
        status: "resolved",
        text: "The ingested chunk text.",
        document_id: "doc-1",
        filename: "doc.pdf",
        chunk_index: 7,
        chunk_count: 30,
      },
      context_items: [
        {
          id: "doc-1:6",
          status: "resolved",
          text: "The preceding chunk.",
          document_id: "doc-1",
          filename: "doc.pdf",
          chunk_index: 6,
          chunk_count: 30,
        },
      ],
    });

    const { result } = renderHook(() =>
      useTraceDebugger({ kind: "document", id: "doc-1", chunkId: "doc-1:7" }),
    );

    await waitFor(() => expect(result.current.graph).not.toBeNull());
    expect(api.fetchDocumentFocusedTrace).toHaveBeenCalledWith(TEST_TOKEN, "doc-1", "doc-1:7");
    expect(result.current.focusedItem?.text).toBe("The ingested chunk text.");
    expect(result.current.contextItems.map((item) => item.id)).toEqual(["doc-1:6"]);
    expect(result.current.focusedItemId).toBe("doc-1:7");
  });

  it("owns focused item selection and clearing", async () => {
    const { result } = renderHook(() =>
      useTraceDebugger({ kind: "run", id: "run-1", chunkId: null }),
    );

    await waitFor(() => expect(result.current.graph).not.toBeNull());
    expect(result.current.focusedItemId).toBeNull();

    act(() => result.current.focusItem("doc:4"));
    expect(result.current.focusedItemId).toBe("doc:4");

    act(() => result.current.clearFocus());
    expect(result.current.focusedItemId).toBeNull();
  });

  it("loads the ingestion origin when a query result is focused in the inspector", async () => {
    api.fetchQueryEventEndToEndTrace.mockResolvedValueOnce({
      retrieval: makeTraceResponse(),
      context_items: [],
      origin: {
        document_id: "doc-1",
        document_name: "doc.pdf",
        chunk_id: "chunk-4",
        trace: makeTraceResponse({
          run: { ...makeTraceResponse().run, id: "run-origin", trigger: "ingest" },
        }),
      },
    });
    const { result } = renderHook(() =>
      useTraceDebugger({ kind: "query", id: "qe-1", chunkId: null }),
    );
    await waitFor(() => expect(result.current.graph).not.toBeNull());

    act(() => result.current.focusItem("chunk-4"));

    await waitFor(() => expect(result.current.graph?.combined).toBe(true));
    expect(api.fetchQueryEventEndToEndTrace).toHaveBeenCalledWith(TEST_TOKEN, "qe-1", "chunk-4");
  });

  it("uses a changed route chunk instead of stale local focus", async () => {
    const { result, rerender } = renderHook(
      ({ chunkId }: { chunkId: string | null }) =>
        useTraceDebugger({ kind: "query", id: "qe-1", chunkId }),
      { initialProps: { chunkId: null as string | null } },
    );
    await waitFor(() => expect(result.current.graph).not.toBeNull());
    act(() => result.current.focusItem("old-chunk"));

    rerender({ chunkId: ROUTE_CHUNK_ID });

    expect(result.current.focusedItemId).toBe(ROUTE_CHUNK_ID);
    await waitFor(() =>
      expect(api.fetchQueryEventEndToEndTrace).toHaveBeenCalledWith(
        TEST_TOKEN,
        "qe-1",
        ROUTE_CHUNK_ID,
      ),
    );
  });

  it("falls back to the plain retrieval graph when no origin exists", async () => {
    api.fetchQueryEventEndToEndTrace.mockResolvedValueOnce({
      retrieval: makeTraceResponse(),
      origin: null,
      context_items: [],
    });

    const { result } = renderHook(() =>
      useTraceDebugger({ kind: "query", id: "qe-1", chunkId: "chunk-1" }),
    );

    await waitFor(() => expect(result.current.graph).not.toBeNull());
    expect(result.current.graph?.combined).toBe(false);
  });

  it("loads a document trace", async () => {
    const { result } = renderHook(() =>
      useTraceDebugger({ kind: "document", id: "doc-1", chunkId: null }),
    );

    await waitFor(() => expect(result.current.graph).not.toBeNull());
    expect(api.fetchDocumentTrace).toHaveBeenCalledWith(TEST_TOKEN, "doc-1");
  });

  it("loads a pipeline-run trace", async () => {
    const { result } = renderHook(() =>
      useTraceDebugger({ kind: "run", id: "run-1", chunkId: null }),
    );

    await waitFor(() => expect(result.current.graph).not.toBeNull());
    expect(api.fetchPipelineRunTrace).toHaveBeenCalledWith(TEST_TOKEN, "run-1");
  });

  it("surfaces a trace fetch failure as the page error", async () => {
    api.fetchDocumentTrace.mockRejectedValueOnce(new Error("nope"));

    const { result } = renderHook(() =>
      useTraceDebugger({ kind: "document", id: "doc-1", chunkId: null }),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.graph).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("still renders the trace when node specs fail, with a notice", async () => {
    api.fetchPipelineNodes.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() =>
      useTraceDebugger({ kind: "run", id: "run-1", chunkId: null }),
    );

    await waitFor(() => expect(result.current.graph).not.toBeNull());
    await waitFor(() => expect(result.current.specsNotice).not.toBeNull());
    expect(result.current.error).toBeNull();
  });
});
