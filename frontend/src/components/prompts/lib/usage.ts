/** Where a prompt's consumer lives, so "used by" can be navigated to. */

import type { PromptUsage } from "@/lib/types";

/**
 * The page that owns a usage.
 *
 * Pipeline node usages carry the pipeline id, so they link to the editor
 * with that pipeline selected; chat and collection-tool usages carry the
 * session and collection ids respectively.
 */
export function usageHref(usage: PromptUsage): string {
  switch (usage.kind) {
    case "pipeline_node": {
      const kind = usage.pipeline_kind ?? "retrieval";
      const node = usage.node_id ? `&node=${encodeURIComponent(usage.node_id)}` : "";
      return `/pipelines/${kind}?pipeline=${usage.id}${node}`;
    }
    case "collection_tool":
      return `/collections/${usage.id}`;
    case "chat_base":
      return "/chat";
  }
}
