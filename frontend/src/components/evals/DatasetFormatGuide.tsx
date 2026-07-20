"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { GlassCard } from "@/components/ui/panel";

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
 */
export function DatasetFormatGuide() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/evals"
          className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.28em] text-muted transition hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-violet"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Evals
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-primary">Dataset format</h1>
        <p className="mt-2 text-sm text-body">
          A dataset is three files in the BEIR layout: the corpus, the queries, and the relevance
          judgments that link them. Upload all three from the Evals page and the parser validates
          every cross-reference before anything is stored.
        </p>
      </div>

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
            uses the score as the gain — <Code>doc-002</Code> below counts as more valuable at rank
            1 than <Code>doc-001</Code>. Recall, precision, MRR, and hit rate treat every positive
            score alike.
          </>
        }
        example={QRELS_EXAMPLE}
        label="qrels.tsv"
      />

      <GlassCard className="rounded-3xl border border-hairline bg-surface p-6">
        <h2 className="text-base font-semibold text-primary">How a run samples the dataset</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-body">
          <li>
            A run samples <Code>num_queries</Code> queries (seeded, reproducible) from the queries
            that carry at least one positive judgment.
          </li>
          <li>
            Every gold document of a sampled query is ingested, so each query is answerable from the
            corpus the run built.
          </li>
          <li>
            <Code>distractor_pool_size</Code> adds that many additional corpus documents the sampled
            queries were not judged against, making retrieval work against realistic noise.
          </li>
          <li>
            Runs that share a dataset and an unchanged ingestion pipeline reuse the same ingested
            collection; only documents not yet in it are ingested.
          </li>
        </ul>
      </GlassCard>
    </div>
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
    <GlassCard className="rounded-3xl border border-hairline bg-surface p-6">
      <h2 className="text-base font-semibold text-primary">{title}</h2>
      <p className="mt-2 text-sm text-body">{description}</p>
      <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.28em] text-muted">{label}</p>
      <pre className="mt-2 overflow-x-auto rounded-xl border border-hairline bg-canvas p-3 font-mono text-[11px] leading-relaxed text-body">
        {example}
      </pre>
    </GlassCard>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-surface-strong px-1 py-0.5 font-mono text-[11px] text-primary">
      {children}
    </code>
  );
}
