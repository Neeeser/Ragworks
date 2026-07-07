import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { middleware } from "@/middleware";

const REQUEST_URL = "http://localhost:3000/api/health?x=1";
const REWRITTEN_URL = "http://backend:8000/api/health?x=1";
const REWRITE_HEADER = "x-middleware-rewrite";

describe("middleware", () => {
  const originalTarget = process.env.API_PROXY_TARGET;

  beforeEach(() => {
    delete process.env.API_PROXY_TARGET;
  });

  afterEach(() => {
    if (originalTarget === undefined) {
      delete process.env.API_PROXY_TARGET;
    } else {
      process.env.API_PROXY_TARGET = originalTarget;
    }
  });

  it("passes the request through unchanged when API_PROXY_TARGET is unset", () => {
    const request = new NextRequest(REQUEST_URL);

    const response = middleware(request);

    expect(response.headers.get(REWRITE_HEADER)).toBeNull();
  });

  it("rewrites /api requests to the configured proxy target", () => {
    process.env.API_PROXY_TARGET = "http://backend:8000";
    const request = new NextRequest(REQUEST_URL);

    const response = middleware(request);

    expect(response.headers.get(REWRITE_HEADER)).toBe(REWRITTEN_URL);
  });

  it("strips a trailing slash from the configured target", () => {
    process.env.API_PROXY_TARGET = "http://backend:8000/";
    const request = new NextRequest(REQUEST_URL);

    const response = middleware(request);

    expect(response.headers.get(REWRITE_HEADER)).toBe(REWRITTEN_URL);
  });
});
