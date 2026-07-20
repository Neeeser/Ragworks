import { DatasetDetail } from "@/components/evals/DatasetDetail";

export default async function EvalDatasetPage({
  params,
}: {
  params: Promise<{ datasetId: string }>;
}) {
  const { datasetId } = await params;
  return <DatasetDetail datasetId={datasetId} />;
}
