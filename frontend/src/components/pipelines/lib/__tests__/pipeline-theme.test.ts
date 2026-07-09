import { describe, expect, it } from "vitest";

import {
  getNodeFamilyLabel,
  getNodeFamilyOrder,
  getNodeFamilyStyles,
  getPortTypeClasses,
  resolveNodeFamily,
} from "@/components/pipelines/lib/pipeline-theme";

describe("pipeline-theme", () => {
  it("resolves node families by prefix and falls back to other", () => {
    expect(resolveNodeFamily("chunker.token")).toBe("chunker");
    expect(resolveNodeFamily("embedder.openrouter")).toBe("embedder");
    expect(resolveNodeFamily("indexer.pinecone")).toBe("indexer");
    expect(resolveNodeFamily("parser.document")).toBe("parser");
    expect(resolveNodeFamily("retriever.pinecone")).toBe("retriever");
    expect(resolveNodeFamily("reranker.cross")).toBe("reranker");
    expect(resolveNodeFamily("router.file_type")).toBe("router");
    expect(resolveNodeFamily("ingestion.input")).toBe("ingestion");
    expect(resolveNodeFamily("retrieval.output")).toBe("retrieval");
    expect(resolveNodeFamily("chat.settings")).toBe("chat");
    expect(resolveNodeFamily("utility.misc")).toBe("utility");
    expect(resolveNodeFamily("custom.node")).toBe("other");
  });

  it("exposes family labels, order, and styles", () => {
    expect(getNodeFamilyLabel("chunker")).toBe("Chunkers");
    const order = getNodeFamilyOrder();
    expect(order[0]).toBe("ingestion");
    order[0] = "other";
    expect(getNodeFamilyOrder()[0]).toBe("ingestion");
    const styles = getNodeFamilyStyles("retriever");
    expect(styles).toEqual(
      expect.objectContaining({
        accent: expect.stringContaining("bg-"),
        border: expect.stringContaining("border-"),
        glow: expect.stringContaining("shadow-"),
        badge: expect.any(String),
      }),
    );
  });

  it("builds port type classes with and without a known type", () => {
    const withType = getPortTypeClasses("document");
    expect(withType.handle).toContain("bg-stage-retrieve");
    const withoutType = getPortTypeClasses();
    expect(withoutType.handle).toContain("bg-stage-neutral");
  });
});
