/** File-tree fixtures (see index.ts for the builder conventions). */
import type { FileNode, FileTree, FileUploadResponse } from "@/lib/types";

export const TIMESTAMP = "2024-01-01T00:00:00.000Z";

export function makeFileNode(overrides: Partial<FileNode> = {}): FileNode {
  return {
    id: "file-1",
    collection_id: "col-1",
    parent_id: null,
    kind: "file",
    name: "doc.txt",
    path: "/doc.txt",
    content_type: "text/plain",
    size_bytes: 128,
    ingestion: {
      document_id: "doc-1",
      status: "ready",
      error_message: null,
      num_chunks: 4,
      num_tokens: 100,
      chunk_size: 512,
      chunk_overlap: 64,
      chunk_strategy: "token",
      embedding_model: "embed-1",
      ingestion_run_id: "run-1",
      updated_at: TIMESTAMP,
    },
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides,
  };
}

export function makeFolderNode(overrides: Partial<FileNode> = {}): FileNode {
  return makeFileNode({
    id: "folder-1",
    kind: "folder",
    name: "reports",
    path: "/reports",
    content_type: null,
    size_bytes: 0,
    ingestion: null,
    ...overrides,
  });
}

export function makeFileTree(overrides: Partial<FileTree> = {}): FileTree {
  return { collection_id: "col-1", nodes: [makeFileNode()], ...overrides };
}

export function makeFileUploadResponse(
  overrides: Partial<FileUploadResponse> = {},
): FileUploadResponse {
  return { file: makeFileNode(), created_folders: [], ...overrides };
}
