import { API_BASE_URL, apiFetch, parseError } from "@/lib/api/client";
import { ApiError } from "@/lib/api-error";
import { formatApiErrorDetail } from "@/lib/errors";

import type {
  FileListing,
  FileNode,
  FileSearchMode,
  FileSearchResponse,
  FileTree,
  FileUploadResponse,
} from "@/lib/types";

export async function fetchFileTree(token: string, collectionId: string): Promise<FileTree> {
  return apiFetch<FileTree>(`/api/collections/${collectionId}/files/tree`, { token });
}

export async function fetchFolderListing(
  token: string,
  collectionId: string,
  parentId?: string | null,
): Promise<FileListing> {
  const query = parentId ? `?parent_id=${encodeURIComponent(parentId)}` : "";
  return apiFetch<FileListing>(`/api/collections/${collectionId}/files${query}`, { token });
}

export async function createFolder(
  token: string,
  collectionId: string,
  name: string,
  parentId?: string | null,
): Promise<FileNode> {
  return apiFetch<FileNode>(`/api/collections/${collectionId}/folders`, {
    method: "POST",
    token,
    body: JSON.stringify({ name, parent_id: parentId ?? null }),
  });
}

export async function uploadFile(
  token: string,
  collectionId: string,
  file: File,
  options?: { parentId?: string | null; relativePath?: string | null },
): Promise<FileUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (options?.parentId) {
    formData.append("parent_id", options.parentId);
  }
  if (options?.relativePath) {
    formData.append("relative_path", options.relativePath);
  }
  return apiFetch<FileUploadResponse>(`/api/collections/${collectionId}/files`, {
    method: "POST",
    body: formData,
    token,
  });
}

export async function updateFileNode(
  token: string,
  fileId: string,
  payload: { name?: string; parent_id?: string | null },
): Promise<FileNode> {
  return apiFetch<FileNode>(`/api/files/${fileId}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(payload),
  });
}

export async function copyFileNode(
  token: string,
  fileId: string,
  parentId?: string | null,
): Promise<FileNode> {
  return apiFetch<FileNode>(`/api/files/${fileId}/copy`, {
    method: "POST",
    token,
    body: JSON.stringify({ parent_id: parentId ?? null }),
  });
}

export async function deleteFileNode(token: string, fileId: string): Promise<void> {
  await apiFetch<void>(`/api/files/${fileId}`, { method: "DELETE", token });
}

export async function ingestFile(token: string, fileId: string): Promise<FileNode> {
  return apiFetch<FileNode>(`/api/files/${fileId}/ingest`, { method: "POST", token });
}

export async function searchFiles(
  token: string,
  collectionId: string,
  query: string,
  modes?: FileSearchMode[],
): Promise<FileSearchResponse> {
  const params = new URLSearchParams({ q: query });
  if (modes && modes.length > 0) {
    params.set("modes", modes.join(","));
  }
  return apiFetch<FileSearchResponse>(
    `/api/collections/${collectionId}/files/search?${params.toString()}`,
    { token },
  );
}

/**
 * Fetch a file's raw bytes as a Blob for previews. Media elements can't send
 * an Authorization header, so previews fetch authenticated bytes and render
 * from an object URL (the caller owns revocation).
 */
export async function fetchFileBlob(token: string, fileId: string): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/api/files/${fileId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const errorData = await parseError(response);
    const detail = errorData?.detail || response.statusText || "Request failed";
    throw new ApiError(
      response.status,
      typeof detail === "string" ? detail : formatApiErrorDetail(detail),
      detail,
    );
  }
  return response.blob();
}
