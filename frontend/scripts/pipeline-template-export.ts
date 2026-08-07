/**
 * The shipped create-pipeline templates, built with fixed sample choices.
 *
 * The wizard's templates are built in TypeScript but validated by the Python
 * engine, so the graphs they produce are exported to `tests/assets/
 * pipeline_templates.json` and checked against the real validator by
 * `tests/pipelines/test_shipped_templates.py`. Without the export, a template
 * naming a port the node registry does not declare is only discovered by a
 * user clicking Create.
 *
 * `export-pipeline-templates.ts` writes the asset; the vitest guard in
 * `pipeline-templates.test.ts` reads these builders to fail while it is stale.
 */
import path from "node:path";

import {
  PIPELINE_TEMPLATES,
  type TemplateBuildOptions,
} from "../src/components/pipelines/lib/pipeline-templates";

import type { IndexBackend, PipelineDefinition } from "../src/lib/types";

/**
 * Where the exported asset lives, resolved from the package directory — both
 * the writer script and the vitest guard run with `frontend/` as their cwd.
 */
export const TEMPLATE_ASSET_PATH = path.resolve(
  process.cwd(),
  "../tests/assets/pipeline_templates.json",
);

/** Stable stand-in for the connections the wizard collects; never resolved. */
const SAMPLE_CONNECTION_ID = "00000000-0000-0000-0000-000000000001";

export const EXPORT_BACKEND: IndexBackend = "pgvector";

export const EXPORT_OPTIONS: TemplateBuildOptions = {
  indexName: "ragworks",
  indexNameMaxLength: 45,
  includeBm25: true,
  embeddingConnectionId: SAMPLE_CONNECTION_ID,
  embeddingModel: "openai/text-embedding-3-small",
  rerankingConnectionId: SAMPLE_CONNECTION_ID,
  rerankingModel: "cohere/rerank-v3.5",
};

export type ExportedTemplate = {
  id: string;
  label: string;
  definition: PipelineDefinition;
};

/** Every shipped template, built with the sample choices. */
export function buildExportedTemplates(): ExportedTemplate[] {
  return PIPELINE_TEMPLATES.map((template) => ({
    id: template.id,
    label: template.label,
    definition: template.build(EXPORT_BACKEND, EXPORT_OPTIONS),
  }));
}

/** The exact bytes the committed asset holds. */
export function serializeTemplates(): string {
  return `${JSON.stringify(buildExportedTemplates(), null, 2)}\n`;
}
