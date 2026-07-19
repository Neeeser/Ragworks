import { describe, expect, it } from "vitest";

import { computeKindCoverage } from "@/components/connections/ConnectionsManager";
import { makeConnection } from "@/test/fixtures";

describe("computeKindCoverage", () => {
  it("never counts a connection whose stored config is invalid", () => {
    // Regression: an invalid-config row lists its descriptor's potential kinds
    // for visibility, so counting them enabled features (e.g. the reranker
    // node) that the backend coverage check rejects.
    const coverage = computeKindCoverage(
      [
        makeConnection({
          provider_type: "tei",
          kinds: ["embedding", "reranking"],
          config_valid: false,
        }),
        makeConnection({ kinds: ["chat"] }),
      ],
      [],
    );

    expect(coverage).toEqual({
      embedding: false,
      chat: true,
      reranking: false,
      vector_store: false,
    });
  });
});
