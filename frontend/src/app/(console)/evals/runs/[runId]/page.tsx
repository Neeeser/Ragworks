import { RunDetail } from "@/components/evals/RunDetail";

export default async function EvalRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <RunDetail runId={runId} />;
}
