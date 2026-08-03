/** Prompt library wire types, hand-mirrored from `app/schemas/prompts.py`. */

import type { UUID } from "./common";

export type PromptContext =
  | "chat.base"
  | "chat.tool"
  | "node.transform"
  | "node.rerank"
  | "node.generate";

export type PromptSource = "user" | "shipped";

export type PromptVersionSelector = number | "latest";

export interface PromptVariable {
  name: string;
  description: string;
  example?: string | null;
}

export interface PromptNamespace {
  prefix: string;
  description: string;
  example_name: string;
}

export interface PromptCatalog {
  context: PromptContext;
  variables: PromptVariable[];
  namespaces: PromptNamespace[];
}

export interface PromptReference {
  prompt_id: UUID;
  version: PromptVersionSelector;
}

export interface PromptRead {
  id: UUID;
  name: string;
  description?: string | null;
  context: PromptContext;
  source: PromptSource;
  shipped_key?: string | null;
  current_version: number;
  usage_count: number;
  created_at: string;
  updated_at?: string | null;
}

export interface PromptUsage {
  kind: "chat_base" | "collection_tool" | "pipeline_node";
  name: string;
  id: string;
  node_id?: string | null;
  pipeline_kind?: "ingestion" | "retrieval" | null;
  version: PromptVersionSelector;
}

export interface PromptDetail extends PromptRead {
  body: string;
  system_body?: string | null;
  output_fields?: Record<string, unknown>[] | null;
  used_by: PromptUsage[];
}

export interface PromptVersionRead {
  id: UUID;
  prompt_id: UUID;
  version: number;
  body: string;
  system_body?: string | null;
  label?: string | null;
  output_fields?: Record<string, unknown>[] | null;
  created_at: string;
}

export interface PromptCreatePayload {
  name: string;
  description?: string | null;
  context: PromptContext;
  body: string;
  system_body?: string | null;
  output_fields?: Record<string, unknown>[] | null;
}

export interface PromptUpdatePayload {
  name?: string;
  description?: string | null;
}

export interface PromptVersionCreatePayload {
  body: string;
  system_body?: string | null;
  label?: string | null;
  output_fields?: Record<string, unknown>[] | null;
}

export interface PromptForkPayload {
  name: string;
  description?: string | null;
  context?: PromptContext | null;
  version?: PromptVersionSelector;
  body?: string | null;
  system_body?: string | null;
  output_fields?: Record<string, unknown>[] | null;
}

export interface PromptRenderPayload {
  body: string;
  system_body?: string | null;
  context: PromptContext;
  values?: Record<string, string>;
}

export interface PromptRenderResult {
  rendered: string;
  rendered_system?: string | null;
  unknown_variables: string[];
  values: Record<string, string>;
}

export interface PromptTestPayload extends PromptRenderPayload {
  connection_id: UUID;
  model_name: string;
  output_fields?: Record<string, unknown>[];
}

export interface PromptTestMessage {
  role: "system" | "user";
  content: string;
}

export interface PromptTestResult {
  rendered: string;
  rendered_system?: string | null;
  messages: PromptTestMessage[];
  response_text?: string | null;
  structured_output?: Record<string, unknown> | null;
}

export type PromptTestStreamEvent =
  | {
      type: "start";
      rendered: string;
      rendered_system?: string | null;
      messages: PromptTestMessage[];
    }
  | { type: "token"; content: string }
  | { type: "structured"; structured_output: Record<string, unknown> }
  | { type: "error"; message: string };

export interface PromptSelection {
  reference: PromptReference | null;
  prompt: PromptRead | null;
  body: string;
  rendered: string;
  context: Record<string, string>;
  variables: PromptVariable[];
}

export interface PromptSelectionUpdatePayload {
  prompt_id: UUID;
  version?: PromptVersionSelector;
}
