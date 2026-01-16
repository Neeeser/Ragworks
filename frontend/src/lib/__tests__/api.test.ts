import { describe, expect, it, vi } from "vitest";

import {
  activatePipelineVersion,
  API_BASE_URL,
  branchChatSession,
  chat,
  computeCollectionUmap,
  createCollection,
  createPipeline,
  createPineconeIndex,
  deleteChatSession,
  deleteCollection,
  deletePipeline,
  deletePineconeIndex,
  describePineconeIndex,
  fetchChunkDetail,
  fetchCollection,
  fetchCollectionStats,
  fetchCollectionStatsById,
  fetchCollectionUmap,
  fetchCollections,
  fetchDocumentChunks,
  fetchDocuments,
  fetchDocumentTrace,
  fetchQueryEventTrace,
  fetchEmbeddingModels,
  fetchPipeline,
  fetchPipelineNodes,
  fetchPipelineRunTrace,
  fetchPipelines,
  getBasePrompt,
  getChatHistory,
  getCollectionPrompt,
  getProfile,
  listChatSessions,
  listModelEndpoints,
  listModels,
  listPipelineVersions,
  listPineconeIndexes,
  loginRequest,
  registerUser,
  runCollectionQuery,
  streamChat,
  updateBasePrompt,
  updateCollection,
  updateCollectionPrompt,
  updatePipeline,
  updateRunSettingsOrder,
  updateUserSettings,
  uploadDocument,
  validatePipeline,
  validateUserKeys,
} from "@/lib/api";

import type { PipelineDefinition } from "@/lib/types";

const createJsonResponse = (
  data: unknown,
  options?: { ok?: boolean; status?: number; statusText?: string },
) => ({
  ok: options?.ok ?? true,
  status: options?.status ?? 200,
  statusText: options?.statusText ?? "OK",
  json: vi.fn().mockResolvedValue(data),
});

const createErrorResponse = (statusText: string, error?: unknown) => ({
  ok: false,
  status: 400,
  statusText,
  json: vi.fn().mockImplementation(async () => {
    if (error instanceof Error) {
      throw error;
    }
    return error ?? {};
  }),
});

const createMockReader = (
  chunks: string[],
  options?: { throwOnRead?: unknown; cancelError?: Error },
) => {
  let index = 0;
  const encoder = new TextEncoder();
  return {
    read: vi.fn(async () => {
      if (options?.throwOnRead && index === 0) {
        throw options.throwOnRead;
      }
      if (index >= chunks.length) {
        return { done: true, value: undefined };
      }
      const value = encoder.encode(chunks[index]);
      index += 1;
      return { done: false, value };
    }),
    cancel: vi.fn(async () => {
      if (options?.cancelError) {
        throw options.cancelError;
      }
    }),
  };
};

const createStreamResponse = (reader: ReturnType<typeof createMockReader>, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  statusText: ok ? "OK" : "Server Error",
  body: {
    getReader: () => reader,
  },
});

const pipelineDefinition: PipelineDefinition = { nodes: [], edges: [] };
const testEmail = "test@example.com";
const testPassword = "secret";
const badRequestStatus = "Bad Request";

describe("api", () => {
  it("exposes a default API base URL", () => {
    expect(API_BASE_URL).toContain("http");
  });

  it("uses NEXT_PUBLIC_API_BASE_URL when provided", async () => {
    const original = process.env.NEXT_PUBLIC_API_BASE_URL;
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://example.com/";
    vi.resetModules();
    const { API_BASE_URL: customBase } = await import("@/lib/api");
    expect(customBase).toBe("http://example.com");
    if (original === undefined) {
      delete process.env.NEXT_PUBLIC_API_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_API_BASE_URL = original;
    }
    vi.resetModules();
  });

  it("handles login and profile requests", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({ access_token: "token", token_type: "bearer" }),
    );

    const login = await loginRequest(testEmail, testPassword);
    expect(login.access_token).toBe("token");

    fetchMock.mockResolvedValueOnce(createJsonResponse({ id: "user-1" }));
    await getProfile("token");
    const profileCall = fetchMock.mock.calls[1];
    expect(profileCall?.[1]?.headers?.get("Authorization")).toBe("Bearer token");
  });

  it("throws a descriptive login error", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValueOnce(createErrorResponse(badRequestStatus, { detail: "nope" }));

    await expect(loginRequest(testEmail, testPassword)).rejects.toThrow("nope");

    fetchMock.mockResolvedValueOnce(createErrorResponse(badRequestStatus, new Error("invalid")));
    await expect(loginRequest(testEmail, testPassword)).rejects.toThrow("Unable to sign in.");
  });

  it("sets JSON headers for authenticated requests", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValueOnce(createJsonResponse({ id: "user-1" }));

    await updateUserSettings("token", { pinecone_api_key: "abc" });
    const [, options] = fetchMock.mock.calls[0];
    const headers = options?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer token");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("skips JSON headers for FormData uploads", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValueOnce(createJsonResponse({ id: "doc-1" }));
    const file = new File(["hello"], "note.txt", { type: "text/plain" });

    await uploadDocument(file, "col-1", "token");
    const [, options] = fetchMock.mock.calls[0];
    const headers = options?.headers as Headers;
    expect(headers.get("Content-Type")).toBeNull();
  });

  it("returns undefined for no-content responses", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValueOnce(createJsonResponse({}, { status: 204 }));

    await expect(deleteChatSession("session-1", "token")).resolves.toBeUndefined();
  });

  it("handles apiFetch errors with fallback parsing", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValueOnce(createErrorResponse(badRequestStatus, new Error("bad json")));

    await expect(fetchCollection("col-1", "token")).rejects.toThrow(badRequestStatus);
  });

  it("stringifies non-string apiFetch errors", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValueOnce(
      createErrorResponse(badRequestStatus, { detail: { message: "bad" } }),
    );

    await expect(fetchCollection("col-1", "token")).rejects.toThrow(
      JSON.stringify({ message: "bad" }),
    );
  });

  it("falls back to default apiFetch error messages", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValueOnce(createErrorResponse("", { detail: "" }));

    await expect(fetchCollection("col-1", "token")).rejects.toThrow("Request failed");
  });

  it("builds chat session query params", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValueOnce(createJsonResponse([]));

    await listChatSessions("token", { collectionIds: ["a", "b"], includeUnassigned: true });
    expect(fetchMock.mock.calls[0]?.[0]).toContain("collection_ids=a");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("collection_ids=b");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("include_unassigned=true");
  });

  it("omits query params when none provided", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValueOnce(createJsonResponse([]));

    await listChatSessions("token");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/chat/sessions");
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain("?");
  });

  it("covers pipeline and collection operations", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValue(createJsonResponse({}));

    await Promise.all([
      registerUser({ email: testEmail, password: testPassword }),
      validateUserKeys("token"),
      fetchCollections("token"),
      fetchCollectionStats("token"),
      fetchCollectionStatsById("col-1", "token"),
      createCollection({ name: "Col" }, "token"),
      updateCollection("col-1", { name: "Updated" }, "token"),
      deleteCollection("col-1", "token"),
      updateRunSettingsOrder("token", ["usage"]),
      fetchPipelines("token", "ingestion"),
      fetchPipelines("token"),
      fetchPipeline("pipe-1", "token"),
      fetchPipelineNodes("token"),
      fetchEmbeddingModels("token"),
      fetchEmbeddingModels("token", true),
      listPineconeIndexes("token"),
      describePineconeIndex("index", "token"),
      createPineconeIndex("token", { name: "index" }),
      deletePineconeIndex("index", "token"),
      validatePipeline("token", pipelineDefinition),
      createPipeline("token", {
        name: "Pipeline",
        kind: "ingestion",
        definition: pipelineDefinition,
      }),
      updatePipeline("pipe-1", "token", { name: "Updated", definition: pipelineDefinition }),
      deletePipeline("pipe-1", "token"),
    ]);
  });

  it("returns pinecone indexes when present", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValueOnce(createJsonResponse({ indexes: [{ name: "idx" }] }));

    const indexes = await listPineconeIndexes("token");
    expect(indexes).toHaveLength(1);
  });

  it("handles prompt updates and document APIs", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({}))
      .mockResolvedValueOnce(createJsonResponse({}))
      .mockResolvedValueOnce(createJsonResponse({}))
      .mockResolvedValueOnce(createJsonResponse([]))
      .mockResolvedValueOnce(createJsonResponse({}))
      .mockResolvedValueOnce(createJsonResponse({}))
      .mockResolvedValueOnce(createJsonResponse({}))
      .mockResolvedValueOnce(createJsonResponse({}))
      .mockResolvedValueOnce(createJsonResponse({}))
      .mockResolvedValueOnce(createJsonResponse([]));

    await Promise.all([
      getBasePrompt("token"),
      updateBasePrompt("template", "token"),
      getCollectionPrompt("col-1", "token"),
      updateCollectionPrompt("col-1", "template", "token"),
      fetchDocuments("col-1", "token"),
      fetchDocumentChunks("doc-1", "token"),
      fetchChunkDetail("chunk-1", "token"),
      fetchCollectionUmap("col-1", "token"),
      computeCollectionUmap("col-1", "token"),
      runCollectionQuery("col-1", { query: "hi" }, "token"),
    ]);
  });

  it("handles pipeline trace and chat mutations", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({}))
      .mockResolvedValueOnce(createJsonResponse({}))
      .mockResolvedValueOnce(createJsonResponse([]))
      .mockResolvedValueOnce(createJsonResponse({}))
      .mockResolvedValueOnce(createJsonResponse({}))
      .mockResolvedValueOnce(createJsonResponse({}))
      .mockResolvedValueOnce(createJsonResponse({}))
      .mockResolvedValueOnce(createJsonResponse({}));

    await Promise.all([
      fetchPipelineRunTrace("run-1", "token"),
      fetchDocumentTrace("doc-1", "token"),
      fetchQueryEventTrace("session-1", "token"),
      listPipelineVersions("pipe-1", "token"),
      activatePipelineVersion("pipe-1", 1, "token"),
      getChatHistory("session-1", "token"),
      branchChatSession("session-1", { message_id: "msg-1" }, "token"),
      chat({ messages: [], model: "model" }, "token"),
    ]);
  });

  it("handles model endpoints", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock
      .mockResolvedValueOnce(createJsonResponse([]))
      .mockResolvedValueOnce(createJsonResponse([]))
      .mockResolvedValueOnce(createJsonResponse({}))
      .mockResolvedValueOnce(createJsonResponse({}));

    await listModels("token", true);
    await listModelEndpoints("openai", "gpt-4o", "token");
    await listModels();
    await listModelEndpoints("openai", "gpt-4o");
  });

  it("streams chat events and returns final payload", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    const chunks = [
      "event: ping\n\n",
      "data:\n\n",
      "data: {invalid}\n\n",
      'data: {"type":"token","content":"Hi"}\n\n',
      'data: {"type":"reasoning","segments":[{"type":"analysis","text":"step"}]}\n\n',
      'data: {"type":"tool_call","id":"tool-1","name":"collection.search","arguments":{"q":"hi"}}\n\n',
      'data: {"type":"tool_result","id":"tool-1","name":"collection.search","arguments":{"q":"hi"},"response":{"ok":true}}\n\n',
      'data: {"type":"final","payload":{"id":"resp-1","choices":[]}}\n\n',
      "data: [DONE]\n\n",
    ];
    const reader = createMockReader(chunks, { cancelError: new Error("cancel") });
    fetchMock.mockResolvedValueOnce(createStreamResponse(reader));

    const handlers = {
      onToken: vi.fn(),
      onReasoning: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onError: vi.fn(),
    };

    const payload = await streamChat({ messages: [], model: "model" }, "token", handlers);
    expect(payload?.id).toBe("resp-1");
    expect(handlers.onToken).toHaveBeenCalledWith("Hi");
    expect(handlers.onToolCall).toHaveBeenCalled();
    expect(handlers.onToolResult).toHaveBeenCalled();
  });

  it("returns final payload when stream ends without DONE", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    const reader = createMockReader([
      'data: {"type":"reasoning"}\n\n',
      'data: {"type":"final","payload":{"id":"resp-2","choices":[]}}\n\n',
    ]);
    fetchMock.mockResolvedValueOnce(createStreamResponse(reader));

    const handlers = { onReasoning: vi.fn() };
    const payload = await streamChat({ messages: [], model: "model" }, "token", handlers);
    expect(payload?.id).toBe("resp-2");
    expect(handlers.onReasoning).toHaveBeenCalledWith([]);
  });

  it("handles stream errors and aborts", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    const readerError = createMockReader(['data: {"type":"error","message":"bad"}\n\n'], {
      cancelError: new Error("cancel"),
    });
    fetchMock.mockResolvedValueOnce(createStreamResponse(readerError));
    const handlers = { onError: vi.fn() };
    await expect(streamChat({ messages: [], model: "model" }, "token", handlers)).rejects.toThrow(
      "bad",
    );
    expect(handlers.onError).toHaveBeenCalledWith("bad");

    const readerAbort = createMockReader([], {
      throwOnRead: new DOMException("Aborted", "AbortError"),
    });
    fetchMock.mockResolvedValueOnce(createStreamResponse(readerAbort));
    await expect(streamChat({ messages: [], model: "model" }, "token")).rejects.toBeInstanceOf(
      DOMException,
    );

    const readerBoom = createMockReader([], { throwOnRead: new Error("boom") });
    fetchMock.mockResolvedValueOnce(createStreamResponse(readerBoom));
    const handlers2 = { onError: vi.fn() };
    await expect(streamChat({ messages: [], model: "model" }, "token", handlers2)).rejects.toThrow(
      "boom",
    );
    expect(handlers2.onError).toHaveBeenCalledWith("boom");

    const readerNonError = createMockReader([], { throwOnRead: "oops" });
    fetchMock.mockResolvedValueOnce(createStreamResponse(readerNonError));
    const handlers3 = { onError: vi.fn() };
    await expect(streamChat({ messages: [], model: "model" }, "token", handlers3)).rejects.toBe(
      "oops",
    );
    expect(handlers3.onError).toHaveBeenCalledWith("Streaming request failed.");
  });

  it("throws on invalid stream responses", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValueOnce(createStreamResponse(createMockReader([]), false));
    await expect(streamChat({ messages: [], model: "model" }, "token")).rejects.toThrow(
      "Server Error",
    );

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad",
      json: vi.fn().mockResolvedValue({ detail: { message: "down" } }),
    });
    await expect(streamChat({ messages: [], model: "model" }, "token")).rejects.toThrow(
      JSON.stringify({ message: "down" }),
    );

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK", body: null });
    await expect(streamChat({ messages: [], model: "model" }, "token")).rejects.toThrow(
      "Streaming response body is not readable.",
    );
  });

  it("falls back to default error message on empty stream error", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    const reader = createMockReader(['data: {"type":"error","message":"  "}\n\n']);
    fetchMock.mockResolvedValueOnce(createStreamResponse(reader));
    const handlers = { onError: vi.fn() };
    await expect(streamChat({ messages: [], model: "model" }, "token", handlers)).rejects.toThrow(
      "Streaming request failed.",
    );
    expect(handlers.onError).toHaveBeenCalledWith("Streaming request failed.");
  });

  it("falls back to default stream errors when HTTP details are missing", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValueOnce(createErrorResponse("", { detail: "" }));

    await expect(streamChat({ messages: [], model: "model" }, "token")).rejects.toThrow(
      "Streaming request failed.",
    );
  });
});
