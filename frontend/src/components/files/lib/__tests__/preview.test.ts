import { describe, expect, it } from "vitest";

import { resolvePreviewKind } from "@/components/files/lib/preview";
import { makeFileNode, makeFolderNode } from "@/test/fixtures";

const GENERIC_TYPE = "application/octet-stream";

function fileOf(name: string, contentType: string | null) {
  return makeFileNode({ name, content_type: contentType });
}

describe("resolvePreviewKind", () => {
  it("dispatches on content type", () => {
    expect(resolvePreviewKind(fileOf("a", "application/pdf"))).toBe("pdf");
    expect(resolvePreviewKind(fileOf("a", "image/png"))).toBe("image");
    expect(resolvePreviewKind(fileOf("a", "audio/mpeg"))).toBe("audio");
    expect(resolvePreviewKind(fileOf("a", "video/mp4"))).toBe("video");
    expect(resolvePreviewKind(fileOf("a", "text/csv"))).toBe("table");
    expect(resolvePreviewKind(fileOf("a", "text/markdown"))).toBe("markdown");
    expect(resolvePreviewKind(fileOf("a", "application/json"))).toBe("json");
    expect(resolvePreviewKind(fileOf("a", "text/plain"))).toBe("text");
  });

  it("falls back to the extension when the content type is generic", () => {
    expect(resolvePreviewKind(fileOf("main.py", GENERIC_TYPE))).toBe("text");
    expect(resolvePreviewKind(fileOf("photo.webp", GENERIC_TYPE))).toBe("image");
    expect(resolvePreviewKind(fileOf("data.tsv", GENERIC_TYPE))).toBe("table");
    expect(resolvePreviewKind(fileOf("notes.md", null))).toBe("markdown");
  });

  it("gives office docs and archives no preview (download only)", () => {
    expect(
      resolvePreviewKind(
        fileOf(
          "report.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
      ),
    ).toBe("none");
    expect(resolvePreviewKind(fileOf("bundle.zip", "application/zip"))).toBe("none");
  });

  it("treats html as text source, never a live document", () => {
    expect(resolvePreviewKind(fileOf("page.html", "text/html"))).toBe("text");
  });

  it("returns none for folders", () => {
    expect(resolvePreviewKind(makeFolderNode())).toBe("none");
  });
});
