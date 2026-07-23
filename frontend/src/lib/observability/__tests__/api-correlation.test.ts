import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api-error";
import {
  REQUEST_ID_HEADER,
  clearObservabilityEntries,
  getObservabilityEntries,
} from "@/lib/observability";

afterEach(() => {
  clearObservabilityEntries();
  vi.restoreAllMocks();
});

describe("apiFetch request correlation", () => {
  it("sends an X-Request-ID header on every request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: vi.fn().mockResolvedValue({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/thing");

    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get(REQUEST_ID_HEADER)).toBeTruthy();
  });

  it("surfaces the backend request id on ApiError and buffers the failure", async () => {
    const responseId = "backend-req-123";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Server Error",
        headers: new Headers({ [REQUEST_ID_HEADER]: responseId }),
        json: vi.fn().mockResolvedValue({ detail: "kaboom" }),
      }),
    );

    await expect(apiFetch("/api/thing?q=1")).rejects.toMatchObject({
      requestId: responseId,
    });
    const isApiError = await apiFetch("/api/other").catch((e) => e instanceof ApiError);
    expect(isApiError).toBe(true);

    const failures = getObservabilityEntries().filter((e) => e.kind === "api_error");
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0].requestId).toBe(responseId);
    expect(failures[0].path).toBe("/api/thing"); // query string stripped
  });
});
