import { describe, expect, it } from "vitest";

import { getErrorMessage, isAbortError } from "@/lib/errors";

describe("getErrorMessage", () => {
  it("returns the message for an Error instance", () => {
    expect(getErrorMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  it("returns the fallback for an Error instance with an empty message", () => {
    expect(getErrorMessage(new Error(""), "fallback")).toBe("fallback");
  });

  it("returns the fallback for non-Error values", () => {
    expect(getErrorMessage("nope", "fallback")).toBe("fallback");
    expect(getErrorMessage(null, "fallback")).toBe("fallback");
    expect(getErrorMessage(undefined, "fallback")).toBe("fallback");
    expect(getErrorMessage({ message: "not an error" }, "fallback")).toBe("fallback");
  });
});

describe("isAbortError", () => {
  it("returns true for a DOMException named AbortError", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
  });

  it("returns false for other DOMExceptions and non-DOMException values", () => {
    expect(isAbortError(new DOMException("nope", "NotAllowedError"))).toBe(false);
    expect(isAbortError(new Error("boom"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
