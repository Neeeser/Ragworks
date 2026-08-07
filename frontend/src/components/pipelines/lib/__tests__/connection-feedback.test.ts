import { describe, expect, it } from "vitest";

import {
  cycleFeedback,
  refusedConnectionFeedback,
  replacedConnectionFeedback,
} from "../connection-feedback";

import type { VocabularyPort } from "../port-vocabulary";

const port = (overrides: Partial<VocabularyPort> = {}): VocabularyPort => ({
  key: "items",
  label: "Items",
  data_type: "items",
  ...overrides,
});

describe("refused connection feedback", () => {
  it("names both streams and the node that bridges them", () => {
    // A chunker's text stream dropped on an indexer, which needs embeddings.
    const feedback = refusedConnectionFeedback(
      port({ adds: ["text"] }),
      port({ label: "Embedded", accepts: ["embedding"], requires: ["embedding"] }),
      ["embedding"],
    );

    expect(feedback.tone).toBe("error");
    expect(feedback.message).toBe("Text items → Embedded items: every item needs embedding.");
    expect(feedback.fix).toBe("Add an Embedder between them.");
  });

  it("names a retriever or reranker as the source of scores", () => {
    const feedback = refusedConnectionFeedback(
      port({ adds: ["text"] }),
      port({ label: "Results", requires: ["score"] }),
      ["score"],
    );

    expect(feedback.message).toBe("Text items → Scored items: every item needs score.");
    expect(feedback.fix).toBe("Add a retriever or a reranker between them.");
  });

  it("lists several missing facets and every node that supplies one", () => {
    const feedback = refusedConnectionFeedback(
      port({ adds: ["file"] }),
      port({ label: "Results", requires: ["text", "score"] }),
      ["score", "text"],
    );

    expect(feedback.message).toBe("File items → Scored items: every item needs score and text.");
    expect(feedback.fix).toBe("Add a retriever or a reranker and a parse node between them.");
  });

  it("offers no fix when the two ports are different planes entirely", () => {
    const feedback = refusedConnectionFeedback(
      port({ adds: ["text"] }),
      port({ label: "Values", data_type: "structured_values" }),
      [],
    );

    // No node bridges items to structured values, so inventing a fix would
    // send the user looking for something that does not exist.
    expect(feedback.message).toBe(
      "Text items → Structured values: these ports carry different data.",
    );
    expect(feedback.fix).toBeUndefined();
  });
});

describe("replacement and cycle feedback", () => {
  it("says which wire the drop removed, and why", () => {
    const feedback = replacedConnectionFeedback("Embedder");

    expect(feedback.tone).toBe("warning");
    expect(feedback.message).toBe(
      "This input takes one connection, so the wire from Embedder was removed.",
    );
  });

  it("spells the loop out as the path it runs around", () => {
    const feedback = cycleFeedback(["Chunker", "Embedder", "Chunker"]);

    expect(feedback.tone).toBe("error");
    expect(feedback.message).toBe("This creates a loop: Chunker → Embedder → Chunker.");
  });
});
