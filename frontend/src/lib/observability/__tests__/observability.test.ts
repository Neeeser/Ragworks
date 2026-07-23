import { afterEach, describe, expect, it } from "vitest";

import {
  buildDiagnosticsReport,
  clearObservabilityEntries,
  getObservabilityEntries,
  recordApiError,
  recordClientError,
} from "@/lib/observability";
import { generateRequestId } from "@/lib/observability/request-id";

afterEach(() => clearObservabilityEntries());

describe("generateRequestId", () => {
  it("returns distinct ids", () => {
    expect(generateRequestId()).not.toBe(generateRequestId());
  });
});

describe("error buffer", () => {
  it("strips the query string from recorded paths", () => {
    recordApiError({
      method: "GET",
      path: "/api/collections/abc?secret=leak&token=xyz",
      status: 500,
      message: "boom",
    });
    const [entry] = getObservabilityEntries();
    expect(entry.path).toBe("/api/collections/abc");
    expect(entry.path).not.toContain("secret");
  });

  it("records the request id and status for an api error", () => {
    recordApiError({
      method: "POST",
      path: "/api/x",
      status: 404,
      requestId: "r-1",
      message: "no",
    });
    const [entry] = getObservabilityEntries();
    expect(entry).toMatchObject({ kind: "api_error", status: 404, requestId: "r-1" });
  });

  it("records client errors", () => {
    recordClientError("render exploded");
    const [entry] = getObservabilityEntries();
    expect(entry).toMatchObject({ kind: "client_error", message: "render exploded" });
  });

  it("caps the buffer at 50 entries, keeping the newest", () => {
    for (let i = 0; i < 60; i += 1) {
      recordClientError(`e${i}`);
    }
    const entries = getObservabilityEntries();
    expect(entries).toHaveLength(50);
    expect(entries[0].message).toBe("e10");
    expect(entries[49].message).toBe("e59");
  });
});

describe("buildDiagnosticsReport", () => {
  it("includes environment context and the buffered entries", () => {
    recordClientError("in the report");
    const report = buildDiagnosticsReport("1.2.3");
    expect(report.appVersion).toBe("1.2.3");
    expect(report.userAgent).toBeTruthy();
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].message).toBe("in the report");
  });
});
