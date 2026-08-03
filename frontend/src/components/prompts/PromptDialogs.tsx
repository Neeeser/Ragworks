"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field, TextInput } from "@/components/ui/field";
import { ModalOverlay } from "@/components/ui/modal-overlay";

import { CONTEXT_LABELS } from "./lib/contexts";

import type { PromptContext } from "@/lib/types";

const CONTEXT_OPTIONS = Object.entries(CONTEXT_LABELS).map(([value, label]) => ({
  value,
  label,
}));

interface CreatePromptDialogProps {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onCreate: (name: string, context: PromptContext) => void;
}

/** Name + context for a new prompt; the body starts as a stub to edit. */
export function CreatePromptDialog({ open, busy, onClose, onCreate }: CreatePromptDialogProps) {
  const titleId = useId();
  const [name, setName] = useState("");
  const [context, setContext] = useState<PromptContext>("chat.base");

  if (!open) return null;
  return (
    <ModalOverlay open onClose={onClose} labelledBy={titleId}>
      <div className="card-surface w-full max-w-md bg-canvas-raised p-4 shadow-elevation-2">
        <h2 id={titleId} className="text-head font-semibold tracking-[-0.01em] text-primary">
          New prompt
        </h2>
        <div className="mt-3 space-y-3">
          <Field label="Name">
            <TextInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Support tone base prompt"
            />
          </Field>
          <Field label="Context">
            <CustomSelect
              value={context}
              placeholder="Context"
              options={CONTEXT_OPTIONS}
              onValueChange={(value) => setContext(value as PromptContext)}
            />
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            glow
            loading={busy}
            disabled={!name.trim() || busy}
            onClick={() => onCreate(name.trim(), context)}
          >
            Create prompt
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}

interface ForkPromptDialogProps {
  open: boolean;
  busy: boolean;
  sourceName: string;
  sourceContext: PromptContext;
  /** Whether the editor draft differs from the saved version. */
  draftChanged: boolean;
  onClose: () => void;
  onFork: (name: string, context: PromptContext) => void;
}

/** Fork a prompt into a new entity, optionally into another context. */
export function ForkPromptDialog({
  open,
  busy,
  sourceName,
  sourceContext,
  draftChanged,
  onClose,
  onFork,
}: ForkPromptDialogProps) {
  const titleId = useId();
  const [name, setName] = useState(`${sourceName} (fork)`);
  const [context, setContext] = useState<PromptContext>(sourceContext);

  if (!open) return null;
  return (
    <ModalOverlay open onClose={onClose} labelledBy={titleId}>
      <div className="card-surface w-full max-w-md bg-canvas-raised p-4 shadow-elevation-2">
        <h2 id={titleId} className="text-head font-semibold tracking-[-0.01em] text-primary">
          Fork prompt
        </h2>
        <p className="mt-1 text-ui text-muted">
          {draftChanged
            ? `Your edited draft of “${sourceName}” becomes v1 of the new prompt.`
            : `Creates a new prompt seeded from the current version of “${sourceName}”.`}{" "}
          Forking into a different context re-validates the variables against that context.
        </p>
        <div className="mt-3 space-y-3">
          <Field label="Name">
            <TextInput value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Context">
            <CustomSelect
              value={context}
              placeholder="Context"
              options={CONTEXT_OPTIONS}
              onValueChange={(value) => setContext(value as PromptContext)}
            />
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            glow
            loading={busy}
            disabled={!name.trim() || busy}
            onClick={() => onFork(name.trim(), context)}
          >
            Fork
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}
