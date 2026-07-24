import { describe, expect, it } from "vitest";

import { makeNodeSpec } from "@/test/fixtures";

import { backendSupportLabel, restrictedBackends } from "../backend-support";

const KNOWN = ["pgvector", "pinecone"] as const;

describe("restrictedBackends", () => {
  it("returns null for a store-agnostic node (no declared backends)", () => {
    const spec = makeNodeSpec({ supported_backends: null });
    expect(restrictedBackends(spec, [...KNOWN])).toBeNull();
  });

  it("returns null for a node that supports every known backend", () => {
    const spec = makeNodeSpec({ supported_backends: ["pgvector", "pinecone"] });
    expect(restrictedBackends(spec, [...KNOWN])).toBeNull();
  });

  it("lists the supported subset for a backend-restricted node", () => {
    const spec = makeNodeSpec({ supported_backends: ["pgvector"] });
    expect(restrictedBackends(spec, [...KNOWN])).toEqual(["pgvector"]);
  });

  it("stays permissive while the known-backend list is still empty", () => {
    const spec = makeNodeSpec({ supported_backends: ["pgvector"] });
    expect(restrictedBackends(spec, [])).toBeNull();
  });

  it("flags a node the moment a new known backend it lacks appears", () => {
    // Simulates adding a third backend the ParadeDB-only node can't serve.
    const spec = makeNodeSpec({ supported_backends: ["pgvector"] });
    expect(restrictedBackends(spec, ["pgvector", "weaviate" as never])).toEqual(["pgvector"]);
  });
});

describe("backendSupportLabel", () => {
  it("renders human backend names, ParadeDB/pgvector first", () => {
    expect(backendSupportLabel(["pgvector"])).toBe("ParadeDB / pgvector");
    expect(backendSupportLabel(["pgvector", "pinecone"])).toBe("ParadeDB / pgvector, Pinecone");
  });
});
