"use client";

import { PageBody } from "@/components/ui/app-shell";
import { CrumbBar } from "@/components/ui/crumb-bar";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel } from "@/components/ui/panel";

const CORPUS_EXAMPLE = `{"_id": "doc-001", "title": "Reset a user password", "text": "Admins reset passwords from the Users page. Select the account, choose Reset password, and the user receives a one-time link valid for 24 hours."}
{"_id": "doc-002", "title": "Password link expiry", "text": "One-time reset links expire after 24 hours. An expired link returns HTTP 410 and the admin must issue a new one."}
{"_id": "doc-003", "title": "Exporting audit logs", "text": "Audit logs export as CSV from Settings > Audit. Exports cover at most 90 days per file."}`;

const QUERIES_EXAMPLE = `{"_id": "q-001", "text": "how long is a password reset link valid"}
{"_id": "q-002", "text": "export audit history to csv"}`;

const QRELS_EXAMPLE = `query-id\tcorpus-id\tscore
q-001\tdoc-001\t1
q-001\tdoc-002\t2
q-001\tdoc-003\t0
q-002\tdoc-003\t1`;

/**
 * Reference page for the BEIR-format dataset upload: the three files, how
 * relevance scores are interpreted, and how runs sample from the dataset.
 *
 * This page is prose by nature, so the card stays full width and the text
 * inside it takes the measure.
 */
export function DatasetFormatGuide() {
  return (
    <>
      <CrumbBar crumbs={[{ label: "Evals", href: "/evals" }, { label: "Dataset format" }]} />

      <PageBody className="flex flex-col gap-3">
        <Panel className="p-3">
          <p className="max-w-[66ch] text-ui text-body">
            A dataset is three files in the BEIR layout: the corpus, the queries, and the relevance
            judgments that link them. Upload all three from the Evals page and the parser validates
            every cross-reference before anything is stored.
          </p>
        </Panel>

        <Section
          title="corpus.jsonl"
          description={
            <>
              One JSON object per line: <Code>_id</Code> (unique document id), optional{" "}
              <Code>title</Code>, and <Code>text</Code>. Each document is ingested through the
              ingestion pipeline under test exactly as a user upload would be; the title, when
              present, is prepended to the text.
            </>
          }
          example={CORPUS_EXAMPLE}
          label="corpus.jsonl"
        />

        <Section
          title="queries.jsonl"
          description={
            <>
              One JSON object per line: <Code>_id</Code> (unique query id) and <Code>text</Code>. A
              query only participates in runs when the qrels file judges it (see below) — unjudged
              queries are stored but never sampled, because there is no ground truth to score them
              against.
            </>
          }
          example={QUERIES_EXAMPLE}
          label="queries.jsonl"
        />

        <Section
          title="qrels (TSV)"
          description={
            <>
              Tab-separated <Code>query-id</Code>, <Code>corpus-id</Code>, <Code>score</Code>; a
              header row is accepted and skipped. Scores follow the TREC convention: <Code>0</Code>{" "}
              means judged and <em>not</em> relevant (the document is never treated as gold), and{" "}
              <Code>1</Code> or higher marks a gold document. Grades above 1 matter to nDCG, which
              uses the score as the gain — <Code>doc-002</Code> below counts as more valuable at
              rank 1 than <Code>doc-001</Code>. Recall, precision, MRR, and hit rate treat every
              positive score alike.
            </>
          }
          example={QRELS_EXAMPLE}
          label="qrels.tsv"
        />

        <Panel className="p-3">
          <h2 className="text-head font-semibold tracking-[-0.01em] text-primary">
            How a run samples the dataset
          </h2>
          <ul className="mt-2 max-w-[66ch] list-disc space-y-2 pl-4 text-ui text-body marker:text-faint">
            <li>
              A run samples <Code>num_queries</Code> queries (seeded, reproducible) from the queries
              that carry at least one positive judgment.
            </li>
            <li>
              Every gold document of a sampled query is ingested, so each query is answerable from
              the corpus the run built.
            </li>
            <li>
              <Code>distractor_pool_size</Code> adds that many additional corpus documents the
              sampled queries were not judged against, making retrieval work against realistic
              noise.
            </li>
            <li>
              Runs that share a dataset and an unchanged ingestion pipeline reuse the same ingested
              collection; only documents not yet in it are ingested.
            </li>
          </ul>
        </Panel>
      </PageBody>
    </>
  );
}

function Section({
  title,
  description,
  example,
  label,
}: {
  title: string;
  description: React.ReactNode;
  example: string;
  label: string;
}) {
  return (
    <Panel className="p-3">
      <h2 className="text-head font-semibold tracking-[-0.01em] text-primary">{title}</h2>
      <p className="mt-2 max-w-[66ch] text-ui text-body">{description}</p>
      <InstrumentLabel className="mt-3 block">{label}</InstrumentLabel>
      <pre className="mt-1 overflow-x-auto rounded-control border border-hairline bg-surface p-3 font-mono text-instrument leading-relaxed text-body">
        {example}
      </pre>
    </Panel>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-chip bg-surface-strong px-1 py-0.5 font-mono text-instrument text-primary">
      {children}
    </code>
  );
}
