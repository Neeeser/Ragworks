"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { GlassCard } from "@/components/ui/panel";

import type { EvalDatasetUploadPayload } from "@/lib/types";

interface UploadDatasetDialogProps {
  open: boolean;
  onUpload: (payload: EvalDatasetUploadPayload) => Promise<boolean>;
  onClose: () => void;
}

interface FilePart {
  label: string;
  hint: string;
  key: "corpus" | "queries" | "qrels";
  accept: string;
}

const FILE_PARTS: FilePart[] = [
  {
    label: "Corpus",
    hint: "corpus.jsonl — {_id, title, text} per line",
    key: "corpus",
    accept: ".jsonl,.json,.txt",
  },
  {
    label: "Queries",
    hint: "queries.jsonl — {_id, text} per line",
    key: "queries",
    accept: ".jsonl,.json,.txt",
  },
  { label: "Qrels", hint: "TSV — query-id, corpus-id, score", key: "qrels", accept: ".tsv,.txt" },
];

export function UploadDatasetDialog({ open, onUpload, onClose }: UploadDatasetDialogProps) {
  const titleId = useId();
  const [name, setName] = useState("");
  const [parts, setParts] = useState<Record<FilePart["key"], string>>({
    corpus: "",
    queries: "",
    qrels: "",
  });
  const [fileNames, setFileNames] = useState<Record<FilePart["key"], string>>({
    corpus: "",
    queries: "",
    qrels: "",
  });
  const [busy, setBusy] = useState(false);

  const ready =
    name.trim() !== "" && parts.corpus !== "" && parts.queries !== "" && parts.qrels !== "";

  const readFile = (key: FilePart["key"]) => async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setParts((prev) => ({ ...prev, [key]: text }));
    setFileNames((prev) => ({ ...prev, [key]: file.name }));
  };

  const handleSubmit = async () => {
    setBusy(true);
    const ok = await onUpload({
      name: name.trim(),
      corpus: parts.corpus,
      queries: parts.queries,
      qrels: parts.qrels,
    });
    setBusy(false);
    if (ok) {
      setName("");
      setParts({ corpus: "", queries: "", qrels: "" });
      setFileNames({ corpus: "", queries: "", qrels: "" });
      onClose();
    }
  };

  return (
    <ModalOverlay open={open} onClose={onClose} labelledBy={titleId}>
      <GlassCard className="w-full max-w-xl rounded-3xl border border-hairline bg-canvas-raised/95 p-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">Datasets</p>
        <h2 id={titleId} className="mt-2 text-xl font-semibold text-primary">
          Upload a dataset
        </h2>
        <p className="mt-1 text-sm text-muted">
          Standard BEIR format: a corpus, queries, and relevance judgments.{" "}
          <Link
            href="/evals/datasets/format"
            className="text-accent-cyan underline-offset-4 hover:underline"
          >
            File formats and examples
          </Link>
        </p>
        <div className="mt-5 space-y-4">
          <Field label="Name">
            <TextInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Support KB eval set"
            />
          </Field>
          {FILE_PARTS.map((part) => (
            <Field key={part.key} label={part.label} hint={part.hint}>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-hairline bg-surface px-4 py-3 text-sm transition hover:border-strong">
                <span className={fileNames[part.key] ? "text-body" : "text-muted"}>
                  {fileNames[part.key] || "Choose file"}
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
                  Browse
                </span>
                <input
                  type="file"
                  accept={part.accept}
                  className="sr-only"
                  onChange={readFile(part.key)}
                />
              </label>
            </Field>
          ))}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy} className="px-5">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!ready} loading={busy} className="px-5">
            Upload
          </Button>
        </div>
      </GlassCard>
    </ModalOverlay>
  );
}
