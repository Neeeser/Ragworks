# Synthetic eval dataset generation

Ragworks can turn one of your collections into a ready-to-run eval dataset:
retrieval questions with document-level relevance labels, written and filtered
by a chat model you choose. No manual labeling is required; the result is a
standard dataset triple (corpus, queries, qrels) that eval runs re-ingest
through the ingestion pipeline under test, exactly like an imported benchmark.

Start it from **Evals → Generate from collection**, or
`POST /api/evals/datasets/generate`.

## What it produces

- **Queries** — questions a user of the collection would plausibly ask, each
  tagged with its question type, quality scores, and the source quote.
- **Qrels** — for every query, the document that answers it, at
  `document` granularity with relevance 1. Labels point at documents rather
  than chunks so they stay valid when you change chunking — the ingestion
  pipeline is part of what the eval measures.
- **Corpus** — each source document's text, reconstructed from its stored
  chunks (chunk overlap stripped). Eval runs re-ingest this corpus through the
  ingestion pipeline you select, so indexing is evaluated too, not just search.

## The pipeline

Generation is a generate-then-filter loop over sampled excerpts of your
collection:

1. **Context sampling.** Excerpts are drawn from the stored chunks of READY
   documents as a rota: every document is sampled an excerpt before any
   document is sampled a second, and the rule repeats each pass until the
   requested count is met. Asking about 20% of a corpus tells you nothing
   about retrieval on the other 80%, so coverage comes before document size —
   a 2-chunk note earns the same number of questions as a 40-chunk report.
   `multi_detail` questions read a window of 2–3 adjacent chunks; other types
   read one chunk. Sampling is seeded — the same request produces the same
   plan, rota order included.
2. **Generation.** One chat call per excerpt asks for up to three candidate
   questions of the sampled type, conditioned on your optional audience
   description and example queries, plus two "distractor" snippets from other
   documents that the question must *not* be answerable from. Every candidate
   must include a verbatim supporting quote.
3. **Mechanical filter.** The quote is matched against the excerpt
   (normalized, near-verbatim). A candidate whose quote is not actually in the
   excerpt is discarded — a free groundedness check that catches most
   hallucinated questions before any further model calls.
4. **Critique.** One batched call scores the survivors 1–5 on groundedness
   (the answer is fully stated in the excerpt), standalone-ness (the question
   makes sense without seeing the excerpt), and realism (a real user would ask
   it). Only candidates scoring ≥4 on all three are kept.
5. **Dedup and coverage.** Near-duplicate questions are dropped, and a
   document holds no more accepted questions than the excerpts the rota has
   offered it — so one excerpt's surplus candidates cannot fill the quota
   while other documents are still unasked about. A document whose excerpt
   yields nothing keeps its turn and can fill it on a later pass; the
   generation stats report how many documents the finished dataset covers.
6. **Stop.** The loop ends when the requested count is reached or the sampled
   contexts run out. Roughly half of generated candidates survive the filters;
   the run plans three excerpts per requested question to absorb that
   attrition, and stops early when the quota fills.

Model output shape is enforced with the provider's structured-outputs feature
(`response_format` with a strict JSON schema), which is why the wizard only
lists chat models that advertise support for it. A tolerant parser remains as
a safety net; a reply it still cannot read discards that batch, never the run.

## Question types

| Type | What it tests |
| --- | --- |
| `single_fact` | One specific fact, short unambiguous answer. |
| `paraphrased` | The question avoids the source's wording — retrieval must work without lexical overlap. |
| `multi_detail` | Combines several details from one document. |

The default mix is 50/25/25; edit it under Advanced in the wizard.

## Steering and curation

- **Audience** (optional) — one sentence describing who asks these questions.
- **Example queries** (optional, up to 3) — real queries whose style, tone,
  and specificity the generator imitates.
- **Review** (optional) — the dataset page lists every query with its type,
  scores, quote, and gold document. Edit a question's text or delete it;
  neither is required before running an eval.

## Reading the result

- The dataset header shows how many source documents the queries cover
  ("queries cover 27 of 50 source documents"). Coverage depends on the
  question count relative to collection size — a small question count over a
  large collection is a spot check, not a full sweep.
- Each generation costs two chat calls per sampled excerpt (generation +
  critique). Progress is visible live on the datasets panel; deleting the
  dataset cancels the run.
- Per-query metadata (type, scores, quote, source chunk ids) is stored on the
  dataset, so runs can be sliced by question type when analyzing results.
