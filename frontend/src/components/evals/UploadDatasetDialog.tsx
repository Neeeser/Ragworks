"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { ModalOverlay } from "@/components/ui/modal-overlay";

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
      <div className="card-surface w-full max-w-xl bg-canvas-raised shadow-elevation-2">
        <div className="border-b border-hairline px-4 py-3">
          <h2 id={titleId} className="text-head font-semibold tracking-[-0.01em] text-primary">
            Upload a dataset
          </h2>
          <p className="mt-1 max-w-[66ch] text-ui text-muted">
            Standard BEIR format: a corpus, queries, and relevance judgments.{" "}
            <Link
              href="/evals/datasets/format"
              className="rounded-control text-accent-cyan underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
            >
              File formats and examples
            </Link>
          </p>
        </div>

        <div className="space-y-4 px-4 py-3">
          <Field label="Name">
            <TextInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Support KB eval set"
            />
          </Field>
          {FILE_PARTS.map((part) => (
            <Field key={part.key} label={part.label} hint={part.hint}>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-control border border-hairline bg-surface px-3 py-2 transition-colors duration-80 ease-standard hover:border-strong focus-within:border-accent-violet focus-within:ring-2 focus-within:ring-accent-violet/30">
                <span
                  className={`truncate text-ui ${fileNames[part.key] ? "text-body" : "text-meta"}`}
                >
                  {fileNames[part.key] || "Choose file"}
                </span>
                <InstrumentLabel>Browse</InstrumentLabel>
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

        <div className="flex justify-end gap-2 border-t border-hairline px-4 py-3">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!ready} loading={busy}>
            Upload
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}
