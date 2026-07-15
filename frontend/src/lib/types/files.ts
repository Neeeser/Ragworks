// Wire types for the collection file tree — hand-mirrored from
// app/schemas/files.py. Change both sides in the same PR.

import type { ChunkStrategy, DocumentStatus } from "@/lib/types/collections";
import type { UUID } from "@/lib/types/common";

export type FileNodeKind = "folder" | "file";

export interface FileIngestion {
  document_id: UUID;
  status: DocumentStatus;
  error_message?: string | null;
  warnings: string[];
  num_chunks: number;
  num_tokens: number;
  chunk_size: number;
  chunk_overlap: number;
  chunk_strategy: ChunkStrategy;
  embedding_model: string;
  ingestion_run_id?: UUID | null;
  updated_at: string;
}

export interface FileNode {
  id: UUID;
  collection_id: UUID;
  parent_id?: UUID | null;
  kind: FileNodeKind;
  name: string;
  path: string;
  content_type?: string | null;
  size_bytes: number;
  ingestion?: FileIngestion | null;
  created_at: string;
  updated_at: string;
}

export interface FileTree {
  collection_id: UUID;
  nodes: FileNode[];
}

export interface FileListing {
  parent?: FileNode | null;
  breadcrumb: FileNode[];
  entries: FileNode[];
}

export interface FileUploadResponse {
  file: FileNode;
  created_folders: FileNode[];
}

export interface FileContentMatch {
  file?: FileNode | null;
  document_id: string;
  chunk_id: string;
  snippet: string;
  score: number;
}

export interface FileSearchResponse {
  query: string;
  folders: FileNode[];
  files: FileNode[];
  content: FileContentMatch[];
}

export type FileSearchMode = "name" | "folder" | "content";
