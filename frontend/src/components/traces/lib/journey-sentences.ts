import type { JourneyStep } from "@/components/traces/lib/journey";

/**
 * One-line accounts of what a node did to the focused result, written in the
 * vocabulary of the item list it acted on (chunks vs matches) — pure functions
 * of the derived journey step, no node-type knowledge. A node type that wants
 * different prose gets it by shaping its item lists, not by a conditional here.
 */

const ordinal = (rank: number | null, count: number | null, noun: string): string => {
  if (rank === null) return noun;
  return count === null ? `${noun} ${rank}` : `${noun} ${rank} of ${count}`;
};

const score = (step: JourneyStep): string =>
  step.score === null || step.score === undefined ? "" : ` · score ${step.score.toFixed(3)}`;

const chunkSentence = (step: JourneyStep): string => {
  switch (step.effect) {
    case "created":
      return `Created as ${ordinal(step.rank, step.outputCount, "chunk")}`;
    case "introduced":
      return `Added here as ${ordinal(step.rank, step.outputCount, "chunk")}`;
    case "passed":
      return step.outputCount === null
        ? "Carried through"
        : `Carried through · ${step.outputCount} chunks`;
    case "reordered":
      return `Moved from position ${step.inputRank} to ${step.rank}`;
    case "merged":
      return `Combined from ${step.inputListCount} inputs as ${ordinal(step.rank, step.outputCount, "chunk")}`;
    case "dropped":
      return `Dropped here · was ${ordinal(step.inputRank, step.inputCount, "chunk")} coming in`;
    case "absent":
      return step.outputCount === null
        ? "Not among this node's chunks"
        : `Not among this node's ${step.outputCount} chunks`;
  }
};

const matchSentence = (step: JourneyStep): string => {
  switch (step.effect) {
    case "created":
    case "introduced":
      return `Matched at ${ordinal(step.rank, step.outputCount, "rank")}${score(step)}`;
    case "passed":
      return `Delivered at ${ordinal(step.rank, step.outputCount, "rank")}${score(step)}`;
    case "reordered":
      return `Rank ${step.inputRank} → ${step.rank}${score(step)}`;
    case "merged":
      return `Fused from ${step.inputListCount} branches · entered at rank ${step.rank}${score(step)}`;
    case "dropped":
      return `Dropped here · was ${ordinal(step.inputRank, step.inputCount, "rank")} coming in`;
    case "absent":
      return step.outputCount === null
        ? "Not in this node's results"
        : `Not in this node's top ${step.outputCount}`;
  }
};

/** The step's one-line effect sentence, keyed on (list kind, effect). */
export const journeySentence = (step: JourneyStep): string =>
  step.role === "chunks" ? chunkSentence(step) : matchSentence(step);

/** Copy for a stage whose nodes attached no item identity lists. */
export const UNRECORDED_SECTION_MESSAGE =
  "No result identity was recorded for this run — it predates result tracing. " +
  "Re-run the query to trace results through it.";
