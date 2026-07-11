"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { ModalOverlay } from "@/components/ui/modal-overlay";

type NewFolderDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<boolean>;
};

export function NewFolderDialog({ open, onClose, onCreate }: NewFolderDialogProps) {
  const titleId = useId();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const created = await onCreate(name.trim());
    setBusy(false);
    if (created) {
      setName("");
      onClose();
    }
  };

  return (
    <ModalOverlay open={open} onClose={onClose} labelledBy={titleId}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="w-full max-w-sm rounded-3xl border border-hairline bg-canvas-raised p-6 shadow-elevation-2"
      >
        <h3 id={titleId} className="text-lg font-semibold text-primary">
          New folder
        </h3>
        <div className="mt-4">
          <Field label="Name">
            <TextInput
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="reports"
            />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!name.trim()}>
            Create
          </Button>
        </div>
      </form>
    </ModalOverlay>
  );
}
