import { fetchFileBlob } from "@/lib/api";

import type { FileNode } from "@/lib/types";

/**
 * Download a file's bytes via the authenticated blob path — a plain
 * `<a href>` can't carry the Authorization header.
 */
export async function downloadFileNode(token: string, node: FileNode): Promise<void> {
  const blob = await fetchFileBlob(token, node.id);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = node.name;
  anchor.click();
  URL.revokeObjectURL(url);
}
