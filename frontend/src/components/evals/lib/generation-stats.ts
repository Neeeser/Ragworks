import type { EvalDataset } from "@/lib/types";

/** Post-generation stats a synthetic dataset records in its generation config. */
export interface GenerationCoverage {
  documentsCovered: number;
  documentsTotal: number;
}

/**
 * Read a synthetic dataset's document coverage from `generation_config.stats`.
 * Returns null for non-synthetic datasets, datasets generated before coverage
 * stats existed, or any unexpected shape.
 */
export function readGenerationCoverage(dataset: EvalDataset): GenerationCoverage | null {
  const stats = (dataset.generation_config as { stats?: unknown } | null | undefined)?.stats;
  if (typeof stats !== "object" || stats === null) return null;
  const { documents_covered: covered, documents_total: total } = stats as {
    documents_covered?: unknown;
    documents_total?: unknown;
  };
  if (typeof covered !== "number" || typeof total !== "number" || total <= 0) return null;
  return { documentsCovered: covered, documentsTotal: total };
}

/** "27 of 50 source documents (54%)" — the coverage sentence fragment. */
export function coverageLabel(coverage: GenerationCoverage): string {
  const percent = Math.round((coverage.documentsCovered / coverage.documentsTotal) * 100);
  return `${coverage.documentsCovered.toLocaleString()} of ${coverage.documentsTotal.toLocaleString()} source documents (${percent}%)`;
}
