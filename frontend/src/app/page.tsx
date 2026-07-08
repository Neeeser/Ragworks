import { ArrowRight, BarChart3, Bot, Layers, Radar, Sparkles, Workflow } from "lucide-react";
import Link from "next/link";

const pipeline = [
  { label: "Parse", description: "Ingest PDFs & text via FastAPI or CLI", icon: Layers },
  {
    label: "Chunk",
    description: "Token, sentence, paragraph & semantic splitting",
    icon: Workflow,
  },
  { label: "Embed", description: "OpenRouter embeddings with audit-friendly storage", icon: Bot },
  {
    label: "Index",
    description: "Deterministic vector-index orchestration per namespace",
    icon: Radar,
  },
  { label: "Chat", description: "Tool-aware conversations with telemetry & usage", icon: Sparkles },
];

const highlights = [
  "Observe every chunk, embedding, and tool call.",
  "Per-user workspaces with JWT + row-level isolation.",
  "Collections tuned with chunk size, overlap, and metadata.",
  "Realtime retriever & chat visibility powered by pgvector/Pinecone + OpenRouter.",
];

export default function LandingPage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center overflow-hidden px-6 py-16 text-slate-100 sm:px-10">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(124,58,237,0.35),transparent_45%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_0%,rgba(14,165,233,0.25),transparent_55%)]" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-16">
        <header className="glass-panel grid gap-10 p-10 text-center md:text-left">
          <p className="text-sm uppercase tracking-[0.4em] text-violet-200">Ragworks</p>
          <div className="space-y-6">
            <h1 className="text-4xl font-semibold leading-tight text-white sm:text-5xl">
              Every RAG signal, surfaced.
            </h1>
            <p className="text-lg text-slate-300 sm:text-xl">
              A control room for parsing, chunking, embedding, indexing, and chatting. Watch the
              pipeline in real-time, orchestrate collections, and hand your users visual evidence of
              what the model consumed.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4 md:justify-start">
            <Link
              href="/auth/sign-in"
              className="flex items-center gap-2 rounded-full bg-violet-500 px-6 py-3 text-base font-semibold text-white shadow-xl shadow-violet-500/40 transition hover:bg-violet-400"
            >
              Launch the console
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </header>

        <section className="grid gap-6 md:grid-cols-5">
          {pipeline.map((step, index) => (
            <div
              key={step.label}
              className="glass-panel flex flex-col gap-3 rounded-2xl p-5 text-left"
            >
              <div className="flex items-center justify-between text-sm text-slate-400">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <step.icon className="h-4 w-4 text-violet-300" />
              </div>
              <p className="text-base font-semibold text-white">{step.label}</p>
              <p className="text-sm text-slate-300">{step.description}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-8 lg:grid-cols-2">
          <div className="glass-panel flex flex-col gap-8 rounded-3xl p-8">
            <div className="flex items-center gap-3">
              <BarChart3 className="h-5 w-5 text-cyan-300" />
              <p className="text-sm uppercase tracking-[0.3em] text-cyan-200">Observability</p>
            </div>
            <h2 className="text-2xl font-semibold text-white">
              Live telemetry for ingestion, retrieval, and chat
            </h2>
            <ul className="space-y-4 text-slate-300">
              {highlights.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-1 h-2 w-2 rounded-full bg-gradient-to-r from-violet-400 to-cyan-300" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="glass-panel rounded-3xl p-8">
            <div className="flex items-center gap-2 text-sm uppercase tracking-[0.3em] text-violet-200">
              <Bot className="h-5 w-5" />
              Live trace
            </div>
            <div className="mt-6 space-y-4">
              {[
                { label: "Model", value: "openai/gpt-oss-120b" },
                { label: "Chunks streamed", value: "12 @ 4.5k ctx" },
                { label: "Tool invoked", value: "pinecone_query" },
                { label: "Latency", value: "1.2s ingest · 450ms retrieval" },
              ].map((metric) => (
                <div
                  key={metric.label}
                  className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/5 px-6 py-4"
                >
                  <span className="text-sm text-slate-400">{metric.label}</span>
                  <span className="text-sm font-semibold text-white">{metric.value}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
