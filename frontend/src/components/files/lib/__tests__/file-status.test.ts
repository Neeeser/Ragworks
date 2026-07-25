import { describe, expect, it } from "vitest";

import { fileStatus } from "@/components/files/lib/file-status";
import { makeFileNode, makeFolderNode } from "@/test/fixtures";

import type { FileIngestion } from "@/lib/types";

const readyIngestion = makeFileNode().ingestion as FileIngestion;

describe("fileStatus", () => {
  it("has no status for a folder", () => {
    expect(fileStatus(makeFolderNode())).toBeNull();
  });

  it("separates a file with no document record from a failure", () => {
    // Uploads always persist; the content-type list only gates auto-ingestion.
    // Reading "not eligible" as "failed" would tell the user the pipeline broke.
    const status = fileStatus(makeFileNode({ ingestion: null }));
    expect(status).toMatchObject({ tone: "neutral", label: "Not indexed", retryable: true });
    expect(status?.detail).not.toMatch(/failed/i);
  });

  it("reports a ready file's indexed chunk count", () => {
    expect(fileStatus(makeFileNode({ ingestion: { ...readyIngestion, num_chunks: 1 } }))).toEqual({
      tone: "pos",
      label: "Ready",
      detail: "Indexed as 1 chunk.",
      retryable: false,
    });
    expect(fileStatus(makeFileNode())?.detail).toBe("Indexed as 4 chunks.");
  });

  it("keeps a warned file ready, because it was still indexed", () => {
    const status = fileStatus(
      makeFileNode({
        ingestion: { ...readyIngestion, warnings: ["Chunk 0 was split into 2 parts."] },
      }),
    );
    expect(status).toMatchObject({ tone: "warn", label: "Ready" });
    expect(status?.detail).toBe("Indexed as 4 chunks, with 1 warning.");
  });

  it("tones in-flight ingestion as active rather than as a warning", () => {
    // A file being ingested does not need attention; a warned one does.
    expect(
      fileStatus(makeFileNode({ ingestion: { ...readyIngestion, status: "pending" } })),
    ).toMatchObject({ tone: "active", label: "Pending" });
    expect(
      fileStatus(makeFileNode({ ingestion: { ...readyIngestion, status: "processing" } })),
    ).toMatchObject({ tone: "active", label: "Processing" });
  });

  it("surfaces the failure's own message and offers a retry", () => {
    expect(
      fileStatus(
        makeFileNode({
          ingestion: { ...readyIngestion, status: "failed", error_message: "parser exploded" },
        }),
      ),
    ).toEqual({ tone: "neg", label: "Failed", detail: "parser exploded", retryable: true });
  });
});
