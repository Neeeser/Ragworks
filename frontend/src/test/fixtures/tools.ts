import type { CollectionTool } from "@/lib/types/tools";

export function makeCollectionTool(overrides: Partial<CollectionTool> = {}): CollectionTool {
  return {
    id: "binding-1",
    collection_id: "col-1",
    pipeline_id: "pipe-1",
    pipeline_name: "Default Retrieval Pipeline",
    name: "search_alpha",
    base_name: "search",
    description: "Search the document collection 'Alpha'.",
    parameters: { type: "object", properties: {}, required: ["query"] },
    arguments: [],
    output_kind: "chunks",
    output_fields: [],
    is_primary: true,
    enabled: true,
    position: 0,
    ...overrides,
  };
}
