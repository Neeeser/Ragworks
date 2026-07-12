import { describe, expect, it } from "vitest";

import {
  breadcrumbFor,
  buildTreeIndex,
  canDropInto,
  childrenOfFolder,
  folderHref,
  formatBytes,
  isProcessing,
  resolveFolder,
} from "@/components/files/lib/tree";
import { makeFileNode, makeFolderNode } from "@/test/fixtures";

const reports = makeFolderNode({ id: "f-reports", name: "reports", path: "/reports" });
const q3 = makeFolderNode({
  id: "f-q3",
  name: "q3",
  parent_id: "f-reports",
  path: "/reports/q3",
});
const doc = makeFileNode({
  id: "file-doc",
  name: "doc.txt",
  parent_id: "f-q3",
  path: "/reports/q3/doc.txt",
});
const rootFile = makeFileNode({ id: "file-root", name: "zeta.txt", path: "/zeta.txt" });

describe("buildTreeIndex", () => {
  it("groups children by parent with folders sorted before files", () => {
    const index = buildTreeIndex([rootFile, doc, q3, reports]);
    expect(childrenOfFolder(index, null).map((node) => node.name)).toEqual(["reports", "zeta.txt"]);
    expect(childrenOfFolder(index, "f-reports").map((node) => node.name)).toEqual(["q3"]);
    expect(childrenOfFolder(index, "f-q3").map((node) => node.name)).toEqual(["doc.txt"]);
  });
});

describe("resolveFolder", () => {
  const index = buildTreeIndex([rootFile, doc, q3, reports]);

  it("walks path segments to the named folder", () => {
    expect(resolveFolder(index, [])).toBeNull();
    expect(resolveFolder(index, ["reports", "q3"])?.id).toBe("f-q3");
  });

  it("returns undefined for a broken path", () => {
    expect(resolveFolder(index, ["reports", "missing"])).toBeUndefined();
  });

  it("does not resolve files as folders", () => {
    expect(resolveFolder(index, ["zeta.txt"])).toBeUndefined();
  });
});

describe("breadcrumbFor", () => {
  it("returns ancestors root-first", () => {
    const index = buildTreeIndex([rootFile, doc, q3, reports]);
    expect(breadcrumbFor(index, q3).map((node) => node.name)).toEqual(["reports", "q3"]);
    expect(breadcrumbFor(index, null)).toEqual([]);
  });
});

describe("folderHref", () => {
  it("URL-encodes each path segment", () => {
    const spaced = makeFolderNode({ id: "f-s", name: "my files", path: "/my files/sub#1" });
    expect(folderHref("col-1", spaced)).toBe("/collections/col-1/files/my%20files/sub%231");
    expect(folderHref("col-1", null)).toBe("/collections/col-1/files");
  });
});

describe("isProcessing", () => {
  it("is true only for pending/processing ingestion states", () => {
    expect(isProcessing(makeFileNode())).toBe(false); // ready fixture
    expect(
      isProcessing(
        makeFileNode({ ingestion: { ...makeFileNode().ingestion!, status: "pending" } }),
      ),
    ).toBe(true);
    expect(isProcessing(makeFileNode({ ingestion: null }))).toBe(false);
  });
});

describe("formatBytes", () => {
  it("scales through units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(15 * 1024 * 1024)).toBe("15 MB");
  });
});

describe("canDropInto", () => {
  const index = buildTreeIndex([rootFile, doc, q3, reports]);

  it("allows moving a file into a different folder", () => {
    expect(canDropInto(index, rootFile, "f-reports")).toBe(true);
    expect(canDropInto(index, doc, null)).toBe(true);
  });

  it("rejects the no-op drop onto the current parent", () => {
    expect(canDropInto(index, rootFile, null)).toBe(false);
    expect(canDropInto(index, doc, "f-q3")).toBe(false);
  });

  it("rejects dropping a folder onto itself or into its own subtree", () => {
    expect(canDropInto(index, reports, "f-reports")).toBe(false);
    expect(canDropInto(index, reports, "f-q3")).toBe(false);
  });
});
