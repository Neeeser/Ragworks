import type { UsageBreakdown } from "@/lib/types";

export const roleVariants: Record<string, string> = {
  user: "border-violet-500/50 bg-violet-600/20 text-violet-50 backdrop-blur-sm",
  assistant: "border-white/20 bg-white/10 text-white backdrop-blur-sm",
  tool: "border-cyan-400/40 bg-cyan-500/15 text-cyan-50 backdrop-blur-sm",
  system: "border-sky-500/30 bg-sky-500/10 text-sky-50",
  reasoning: "border-amber-400/50 bg-amber-500/15 text-amber-50 backdrop-blur-sm",
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
      <span className="text-slate-100/80">
        $
        {usage.cost.toLocaleString(undefined, {
          minimumFractionDigits: 4,
          maximumFractionDigits: 6,
        })}
      </span>
    )}
  </>
);
