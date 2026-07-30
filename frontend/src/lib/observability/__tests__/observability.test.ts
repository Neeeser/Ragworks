import { afterEach, describe, expect, it } from "vitest";

import {
  buildDiagnosticsReport,
  clearObservabilityEntries,
  getObservabilityEntries,
  installClientErrorCapture,
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

// Firefox's wording for an unterminated template literal — the real report
// that showed a parse error can arrive with no script attribution.
const PARSE_ERROR = "`` literal not terminated before end of script";

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

  it("records where an uncaught error came from, not just its message", () => {
    // A bare parse-error message ("`` literal not terminated before end of
    // script") names no script, so a downloaded report cannot say which
    // bundle chunk failed — the source is the whole diagnostic value.
    installClientErrorCapture();
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: PARSE_ERROR,
        filename: "http://localhost:3000/_next/static/chunks/app/page.js?v=123",
        lineno: 42,
        colno: 7,
      }),
    );
    const [entry] = getObservabilityEntries();
    expect(entry.kind).toBe("client_error");
    expect(entry.source).toBe("/_next/static/chunks/app/page.js:42:7");
  });

  it("records the script a rejected promise's error came from", () => {
    // A SyntaxError surfacing through unhandledrejection carries no
    // `filename`, so its stack is the only thing naming the script — without
    // it the entry is an unattributable string.
    installClientErrorCapture();
    const error = new SyntaxError(PARSE_ERROR);
    error.stack =
      "@http://localhost:3000/_next/static/chunks/app/page.js?v=9:815:22\nx@http://localhost:3000/other.js:1:1";
    const event = new Event("unhandledrejection");
    Object.defineProperty(event, "reason", { value: error });
    window.dispatchEvent(event);

    const [entry] = getObservabilityEntries();
    expect(entry.message).toBe(PARSE_ERROR);
    expect(entry.source).toBe("/_next/static/chunks/app/page.js:815:22");
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
