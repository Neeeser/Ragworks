import { describe, expect, it } from "vitest";

import { nodeDisplayStatus } from "@/components/traces/lib/node-status";
import { makeNodeRunTrace } from "@/test/fixtures";

const parseSummary = (parsedItems: Array<{ id: string; score: null }>, unread: boolean) => ({
  inputs: [],
  outputs: [
    { label: "Items", value: { count: parsedItems.length }, kind: "json" as const },
    {
      label: "Parsed items",
      value: { kind: "chunks", items: parsedItems },
      kind: "items" as const,
    },
    ...(unread
      ? [
          {
            label: "Unread files",
            value: { count: 1, media_types: ["image/png"] },
            kind: "json" as const,
          },
        ]
      : []),
  ],
});

describe("nodeDisplayStatus", () => {
  it("derives skipped for a parse node that declined the file and emitted nothing", () => {
    const run = makeNodeRunTrace({ summary: parseSummary([], true) });
    expect(nodeDisplayStatus(run)).toBe("skipped");
  });

  it("keeps completed when the node read the file", () => {
    const run = makeNodeRunTrace({
      summary: parseSummary([{ id: "chunk-1", score: null }], false),
    });
    expect(nodeDisplayStatus(run)).toBe("completed");
  });

  it("keeps completed for a parsed file that genuinely held nothing", () => {
    // No Unread files value: the node read the file and found nothing —
    // an honest empty result, not a skip.
    const run = makeNodeRunTrace({ summary: parseSummary([], false) });
    expect(nodeDisplayStatus(run)).toBe("completed");
  });

  it("keeps completed when the declined file rode through beside handled items", () => {
    const run = makeNodeRunTrace({
      summary: parseSummary([{ id: "chunk-1", score: null }], true),
    });
    expect(nodeDisplayStatus(run)).toBe("completed");
  });

  it("never rewrites a settled failure or degradation", () => {
    expect(nodeDisplayStatus(makeNodeRunTrace({ status: "failed" }))).toBe("failed");
    expect(nodeDisplayStatus(makeNodeRunTrace({ status: "degraded" }))).toBe("degraded");
    expect(nodeDisplayStatus(null)).toBeUndefined();
  });
});
