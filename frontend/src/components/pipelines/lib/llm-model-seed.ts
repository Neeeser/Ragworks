import { isLlmNodeType } from "./llm";

import type { NodeSpec } from "@/lib/types";

/** A `(connection, model)` pair as an LLM node config stores it. */
export type ChatModelIdentity = { connectionId: string; modelId: string };

/**
 * An LLM shell spec with the user's most recent chat model filled in.
 *
 * An LLM node that lands with no model cannot run until the user opens its
 * drawer and picks one — a second trip for something the app already knows.
 * Nothing is invented: a spec or preset that names its own model keeps it, and
 * with no recent model the spec comes back untouched, because a guessed model
 * is worse than the empty picker the drawer already shows.
 */
export const withSeededChatModel = (spec: NodeSpec, recent: ChatModelIdentity | null): NodeSpec => {
  if (!recent || !isLlmNodeType(spec.type)) return spec;
  const config = spec.default_config ?? {};
  const named = (key: string) => typeof config[key] === "string" && config[key] !== "";
  if (named("connection_id") || named("model_name")) return spec;
  return {
    ...spec,
    default_config: { ...config, connection_id: recent.connectionId, model_name: recent.modelId },
  };
};
