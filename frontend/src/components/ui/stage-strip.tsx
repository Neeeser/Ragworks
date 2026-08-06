import { cn } from "@/lib/utils";

/** Pipeline stages a strip can depict — the editor's colour language. */
export type StripStage = "parse" | "chunk" | "embed" | "index" | "retrieve" | "chat" | "rerank";

const STAGE_BG: Record<StripStage, string> = {
  parse: "bg-stage-parse",
  chunk: "bg-stage-chunk",
  embed: "bg-stage-embed",
  index: "bg-stage-index",
  retrieve: "bg-stage-retrieve",
  chat: "bg-stage-chat",
  rerank: "bg-stage-rerank",
};

type StageStripProps = {
  /** The stages the bound pipeline actually contains, in flow order. */
  stages: StripStage[];
  /** Plain factual summary beside the strip, e.g. `hybrid · RRF · pgvector`. */
  summary?: string;
  className?: string;
};

/**
 * A bound pipeline as row metadata: stage-coloured node dots joined by
 * hairline wires, plus a plain-text summary.
 *
 * A supporting signature mark — it appears only where a real pipeline is
 * bound, never as decoration, and never exceeds one line. The dots share the
 * editor's and trace viewer's stage colours so the whole product speaks one
 * dialect.
 */
export function StageStrip({ stages, summary, className }: StageStripProps) {
  return (
    <span className={cn("flex min-w-0 items-center", className)}>
      {stages.map((stage, index) => (
        <span key={`${stage}-${index}`} className="flex items-center" aria-hidden>
          {index > 0 ? <span className="h-px w-2.5 bg-hairline" /> : null}
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-[2px]", STAGE_BG[stage])} />
        </span>
      ))}
      {summary ? <span className="ml-2 truncate text-instrument text-meta">{summary}</span> : null}
    </span>
  );
}
