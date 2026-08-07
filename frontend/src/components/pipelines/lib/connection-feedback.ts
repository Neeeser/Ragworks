/**
 * What the editor tells a user about a connection it just refused, replaced,
 * or turned into a loop.
 *
 * Every message names the two streams in the canonical port vocabulary and,
 * where the validator knows one, the node that bridges them: a refusal that
 * only says "invalid connection" leaves the user to guess which of the two
 * ports was wrong and what would fix it, which on a facet-typed graph is not
 * guessable.
 */

import { portTypeName } from "./port-vocabulary";

import type { VocabularyPort } from "./port-vocabulary";

export type ConnectionFeedbackTone = "error" | "warning";

export type ConnectionFeedback = {
  tone: ConnectionFeedbackTone;
  message: string;
  /** What to do about it; absent when nothing the user can add would help. */
  fix?: string;
};

/**
 * The node that adds each facet — the answer to "what goes between these two".
 *
 * Named by what the node library calls them, so the fix is a thing the user
 * can go and find rather than a facet name from the type system.
 */
const FACET_SOURCES: Record<string, string> = {
  embedding: "an Embedder",
  text: "a parse node",
  image: "an image parse node",
  score: "a retriever or a reranker",
  file: "an ingestion input",
};

const listAnd = (values: readonly string[]): string =>
  values.length <= 1
    ? (values[0] ?? "")
    : `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;

/**
 * A refused drop, named in both directions with the fix where one exists.
 *
 * `missing` are the facets the target requires that the source's stream does
 * not guarantee — the validator computed them already, so the message can say
 * what to add instead of that something is wrong.
 */
export const refusedConnectionFeedback = (
  sourcePort: VocabularyPort,
  targetPort: VocabularyPort,
  missing: readonly string[],
): ConnectionFeedback => {
  const from = portTypeName(sourcePort, "output");
  const to = portTypeName(targetPort, "input");
  if (missing.length === 0) {
    // Different planes entirely (items vs structured values vs result). No
    // node bridges these, so offering a fix would be inventing one.
    return { tone: "error", message: `${from} → ${to}: these ports carry different data.` };
  }
  const bridges = [...new Set(missing.map((facet) => FACET_SOURCES[facet]).filter(Boolean))];
  return {
    tone: "error",
    message: `${from} → ${to}: every item needs ${listAnd([...missing].sort())}.`,
    fix: bridges.length > 0 ? `Add ${listAnd(bridges)} between them.` : undefined,
  };
};

/** A drop onto an input that already has a wire — legal, and it costs the old one. */
export const replacedConnectionFeedback = (replacedSourceLabel: string): ConnectionFeedback => ({
  tone: "warning",
  message: `This input takes one connection, so the wire from ${replacedSourceLabel} was removed.`,
});

/** A drop that closed a loop, named as the path it runs around. */
export const cycleFeedback = (nodeNames: readonly string[]): ConnectionFeedback => ({
  tone: "error",
  message: `This creates a loop: ${nodeNames.join(" → ")}.`,
  fix: "A pipeline runs its nodes in order, so it cannot contain one.",
});

/** A refusal the validator phrased itself (self-connection, missing ports). */
export const plainRefusalFeedback = (reason: string): ConnectionFeedback => ({
  tone: "error",
  message: reason,
});
