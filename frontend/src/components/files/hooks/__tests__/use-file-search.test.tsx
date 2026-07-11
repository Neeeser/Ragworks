import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import * as apiModule from "@/lib/api";
import { makeFileNode, makeFolderNode } from "@/test/fixtures";

import { useFileSearch } from "../use-file-search";

import type { FileSearchMode } from "@/lib/types";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

const nodes = [
  makeFolderNode({ id: "f1", name: "reports" }),
  makeFileNode({ id: "a", name: "report-q3.txt" }),
  makeFileNode({ id: "b", name: "notes.md" }),
];

const ALL: Set<FileSearchMode> = new Set(["name", "folder", "content"]);

describe("useFileSearch", () => {
  it("matches file and folder names locally, case-insensitively", () => {
    const { result } = renderHook(() => useFileSearch("token", "col-1", nodes, "REPORT", ALL));
    expect(result.current.folders.map((node) => node.id)).toEqual(["f1"]);
    expect(result.current.files.map((node) => node.id)).toEqual(["a"]);
  });

  it("honors the mode filter", () => {
    const { result } = renderHook(() =>
      useFileSearch("token", "col-1", nodes, "report", new Set<FileSearchMode>(["folder"])),
    );
    expect(result.current.folders.map((node) => node.id)).toEqual(["f1"]);
    expect(result.current.files).toEqual([]);
  });

  it("debounces content search through the search endpoint", async () => {
    api.searchFiles.mockResolvedValueOnce({
      query: "report",
      folders: [],
      files: [],
      content: [
        {
          file: nodes[1],
          document_id: "doc-1",
          chunk_id: "doc-1:0",
          snippet: "quarterly numbers",
          score: 0.9,
        },
      ],
    });

    const { result } = renderHook(() => useFileSearch("token", "col-1", nodes, "report", ALL));

    await waitFor(() => expect(result.current.content).toHaveLength(1));
    expect(api.searchFiles).toHaveBeenCalledWith("token", "col-1", "report", ["content"]);
    expect(result.current.content[0].snippet).toBe("quarterly numbers");
  });

  it("never calls the endpoint when content mode is off", async () => {
    renderHook(() =>
      useFileSearch("token", "col-1", nodes, "report", new Set<FileSearchMode>(["name"])),
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(api.searchFiles).not.toHaveBeenCalled();
  });
});
