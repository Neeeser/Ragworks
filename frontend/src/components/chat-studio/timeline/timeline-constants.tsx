import { Readout } from "@/components/ui/readout";

import type { UsageBreakdown } from "@/lib/types";

/**
 * The surface each transcript entry sits on.
 *
 * Only the entries that are *not* the assistant's prose carry a fill: a user
 * turn, a tool call, a reasoning block, an error. The assistant's answer is the
 * thing being read, so it sits on the card's own material with a measure rather
 * than in a tinted box.
 */
export const roleVariants: Record<string, string> = {
  user: "border-accent-violet/40 bg-accent-violet/12 text-body",
  assistant: "border-transparent text-body",
  tool: "border-hairline bg-surface text-body",
  error: "border-data-neg/40 bg-data-neg/10 text-body",
  system: "border-hairline bg-surface text-body",
  reasoning: "border-stage-embed/40 bg-stage-embed/10 text-body",
};

/** What one turn cost, as a row of labelled readouts. */
export const UsageInline = ({ usage }: { usage: UsageBreakdown }) => (
  <>
    {usage.total_tokens != null && (
      <Readout label="Total">{usage.total_tokens.toLocaleString()}</Readout>
    )}
    {usage.prompt_tokens != null && (
      <Readout label="In">{usage.prompt_tokens.toLocaleString()}</Readout>
    )}
    {usage.completion_tokens != null && (
      <Readout label="Out">{usage.completion_tokens.toLocaleString()}</Readout>
    )}
    {usage.reasoning_tokens != null && usage.reasoning_tokens > 0 && (
      <Readout label="Reasoning">{usage.reasoning_tokens.toLocaleString()}</Readout>
    )}
    {usage.cost != null && (
      <Readout label="Cost">
        {`$${usage.cost.toLocaleString(undefined, {
          minimumFractionDigits: 4,
          maximumFractionDigits: 6,
        })}`}
      </Readout>
    )}
  </>
);
