import type { UsageBreakdown } from "@/lib/types";

export const roleVariants: Record<string, string> = {
  user: "border-accent-violet/50 bg-accent-violet/15 text-body backdrop-blur-sm",
  assistant: "border-hairline bg-surface-strong text-body backdrop-blur-sm",
  tool: "border-accent-cyan/40 bg-accent-cyan/10 text-body backdrop-blur-sm",
  error: "border-data-neg/40 bg-data-neg/10 text-body backdrop-blur-sm",
  system: "border-hairline bg-surface text-body",
  reasoning: "border-stage-embed/50 bg-stage-embed/15 text-body backdrop-blur-sm",
};

export const UsageInline = ({ usage }: { usage: UsageBreakdown }) => (
  <>
    {usage.total_tokens != null && <span>{usage.total_tokens.toLocaleString()} tok</span>}
    {usage.prompt_tokens != null && <span>{usage.prompt_tokens.toLocaleString()} in</span>}
    {usage.completion_tokens != null && <span>{usage.completion_tokens.toLocaleString()} out</span>}
    {usage.reasoning_tokens != null && usage.reasoning_tokens > 0 && (
      <span>{usage.reasoning_tokens.toLocaleString()} reasoning</span>
    )}
    {usage.cost != null && (
      <span className="text-body">
        $
        {usage.cost.toLocaleString(undefined, {
          minimumFractionDigits: 4,
          maximumFractionDigits: 6,
        })}
      </span>
    )}
  </>
);
