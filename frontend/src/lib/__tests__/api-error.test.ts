import { describe, expect, it } from "vitest";

import { ApiError, isUnauthorized } from "@/lib/api-error";

describe("ApiError", () => {
  it("is an instance of Error and stores status/detail", () => {
    const error = new ApiError(404, "Not found");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(404);
    expect(error.detail).toBe("Not found");
  });

  it("uses detail as the error message", () => {
    const error = new ApiError(500, "Internal server error");

    expect(error.message).toBe("Internal server error");
  });

  it("keeps structured detail for inline recovery", () => {
    const detail = { issues: [{ message: "Pick another model." }] };
    const error = new ApiError(400, "Pick another model.", detail);

    expect(error.detail).toBe(detail);
  });
});

describe("isUnauthorized", () => {
  it("returns true for an ApiError with status 401", () => {
    expect(isUnauthorized(new ApiError(401, "Unauthorized"))).toBe(true);
  });

  it("returns false for an ApiError with a different status", () => {
    expect(isUnauthorized(new ApiError(403, "Forbidden"))).toBe(false);
  });

  it("returns false for non-ApiError values", () => {
    expect(isUnauthorized(new Error("plain error"))).toBe(false);
    expect(isUnauthorized("nope")).toBe(false);
    expect(isUnauthorized(null)).toBe(false);
    expect(isUnauthorized(undefined)).toBe(false);
  });
});
