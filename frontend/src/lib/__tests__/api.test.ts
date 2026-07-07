import { describe, expect, it, vi } from "vitest";

import {
  activatePipelineVersion,
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
import { ApiError } from "@/lib/api-error";

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
const streamingRequestFailedMessage = "Streaming request failed.";

describe("api", () => {
  it("falls back to a same-origin base URL when NEXT_PUBLIC_API_BASE_URL is unset", async () => {
    const original = process.env.NEXT_PUBLIC_API_BASE_URL;
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    vi.resetModules();
    const { API_BASE_URL: defaultBase } = await import("@/lib/api");
    expect(defaultBase).toBe("");
    if (original !== undefined) {
      process.env.NEXT_PUBLIC_API_BASE_URL = original;
    }
    vi.resetModules();
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

    await uploadDocument("token", "col-1", file);
    const [, options] = fetchMock.mock.calls[0];
    const headers = options?.headers as Headers;
    expect(headers.get("Content-Type")).toBeNull();
  });

  it("returns undefined for no-content responses", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValueOnce(createJsonResponse({}, { status: 204 }));

    await expect(deleteChatSession("token", "session-1")).resolves.toBeUndefined();
  });

  it("handles apiFetch errors with fallback parsing", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValueOnce(createErrorResponse(badRequestStatus, new Error("bad json")));

    await expect(fetchCollection("token", "col-1")).rejects.toThrow(badRequestStatus);
    fetchMock.mockResolvedValueOnce(createErrorResponse(badRequestStatus, new Error("bad json")));
    await expect(fetchCollection("token", "col-1")).rejects.toBeInstanceOf(ApiError);
    fetchMock.mockResolvedValueOnce(createErrorResponse(badRequestStatus, new Error("bad json")));
    await expect(fetchCollection("token", "col-1")).rejects.toMatchObject({
      status: 400,
      detail: badRequestStatus,
    });
  });

  it("stringifies non-string apiFetch errors", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValueOnce(
      createErrorResponse(badRequestStatus, { detail: { message: "bad" } }),
    );

    await expect(fetchCollection("token", "col-1")).rejects.toThrow(
      JSON.stringify({ message: "bad" }),
    );
  });

  it("falls back to default apiFetch error messages", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValueOnce(createErrorResponse("", { detail: "" }));

    await expect(fetchCollection("token", "col-1")).rejects.toThrow("Request failed");
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
      fetchCollectionStatsById("token", "col-1"),
      createCollection("token", { name: "Col" }),
      updateCollection("token", "col-1", { name: "Updated" }),
      deleteCollection("token", "col-1"),
      updateRunSettingsOrder("token", ["usage"]),
      fetchPipelines("token", "ingestion"),
      fetchPipelines("token"),
      fetchPipeline("token", "pipe-1"),
      fetchPipelineNodes("token"),
      fetchEmbeddingModels("token"),
      fetchEmbeddingModels("token", true),
      listPineconeIndexes("token"),
      describePineconeIndex("token", "index"),
      createPineconeIndex("token", { name: "index" }),
      deletePineconeIndex("token", "index"),
      validatePipeline("token", pipelineDefinition),
      createPipeline("token", {
        name: "Pipeline",
        kind: "ingestion",
        definition: pipelineDefinition,
      }),
      updatePipeline("token", "pipe-1", { name: "Updated", definition: pipelineDefinition }),
      deletePipeline("token", "pipe-1"),
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
      updateBasePrompt("token", "template"),
      getCollectionPrompt("token", "col-1"),
      updateCollectionPrompt("token", "col-1", "template"),
      fetchDocuments("token", "col-1"),
      fetchDocumentChunks("token", "doc-1"),
      fetchChunkDetail("token", "chunk-1"),
      fetchCollectionUmap("token", "col-1"),
      computeCollectionUmap("token", "col-1"),
      runCollectionQuery("token", "col-1", { query: "hi" }),
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
      fetchPipelineRunTrace("token", "run-1"),
      fetchDocumentTrace("token", "doc-1"),
      fetchQueryEventTrace("token", "session-1"),
      listPipelineVersions("token", "pipe-1"),
      activatePipelineVersion("token", "pipe-1", 1),
      getChatHistory("token", "session-1"),
      branchChatSession("token", "session-1", { message_id: "msg-1" }),
      chat("token", { content: "Hello", chat_model: "model" }),
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
    await listModelEndpoints("token", "openai", "gpt-4o");
    await listModels();
    await listModelEndpoints(undefined, "openai", "gpt-4o");
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

    const payload = await streamChat("token", { content: "Hello", chat_model: "model" }, handlers);
    // The mocked SSE payload uses a raw completion shape to test passthrough,
    // which the current ChatCompletionPayload type does not model.
    expect((payload as unknown as { id?: string } | null)?.id).toBe("resp-1");
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
    const payload = await streamChat("token", { content: "Hello", chat_model: "model" }, handlers);
    expect((payload as unknown as { id?: string } | null)?.id).toBe("resp-2");
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
    await expect(
      streamChat("token", { content: "Hello", chat_model: "model" }, handlers),
    ).rejects.toThrow("bad");
    expect(handlers.onError).toHaveBeenCalledWith("bad");

    const readerAbort = createMockReader([], {
      throwOnRead: new DOMException("Aborted", "AbortError"),
    });
    fetchMock.mockResolvedValueOnce(createStreamResponse(readerAbort));
    await expect(
      streamChat("token", { content: "Hello", chat_model: "model" }),
    ).rejects.toBeInstanceOf(DOMException);

    const readerBoom = createMockReader([], { throwOnRead: new Error("boom") });
    fetchMock.mockResolvedValueOnce(createStreamResponse(readerBoom));
    const handlers2 = { onError: vi.fn() };
    await expect(
      streamChat("token", { content: "Hello", chat_model: "model" }, handlers2),
    ).rejects.toThrow("boom");
    expect(handlers2.onError).toHaveBeenCalledWith("boom");

    const readerNonError = createMockReader([], { throwOnRead: "oops" });
    fetchMock.mockResolvedValueOnce(createStreamResponse(readerNonError));
    const handlers3 = { onError: vi.fn() };
    await expect(
      streamChat("token", { content: "Hello", chat_model: "model" }, handlers3),
    ).rejects.toBe("oops");
    expect(handlers3.onError).toHaveBeenCalledWith(streamingRequestFailedMessage);
  });

  it("throws on invalid stream responses", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValueOnce(createStreamResponse(createMockReader([]), false));
    await expect(streamChat("token", { content: "Hello", chat_model: "model" })).rejects.toThrow(
      "Server Error",
    );

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad",
      json: vi.fn().mockResolvedValue({ detail: { message: "down" } }),
    });
    await expect(streamChat("token", { content: "Hello", chat_model: "model" })).rejects.toThrow(
      JSON.stringify({ message: "down" }),
    );

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK", body: null });
    await expect(streamChat("token", { content: "Hello", chat_model: "model" })).rejects.toThrow(
      "Streaming response body is not readable.",
    );
  });

  it("falls back to default error message on empty stream error", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    const reader = createMockReader(['data: {"type":"error","message":"  "}\n\n']);
    fetchMock.mockResolvedValueOnce(createStreamResponse(reader));
    const handlers = { onError: vi.fn() };
    await expect(
      streamChat("token", { content: "Hello", chat_model: "model" }, handlers),
    ).rejects.toThrow(streamingRequestFailedMessage);
    expect(handlers.onError).toHaveBeenCalledWith(streamingRequestFailedMessage);
  });

  it("falls back to default stream errors when HTTP details are missing", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValueOnce(createErrorResponse("", { detail: "" }));

    await expect(streamChat("token", { content: "Hello", chat_model: "model" })).rejects.toThrow(
      streamingRequestFailedMessage,
    );
  });
});
