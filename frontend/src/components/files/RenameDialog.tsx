"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { ModalOverlay } from "@/components/ui/modal-overlay";

import type { FileNode } from "@/lib/types";

type RenameDialogProps = {
  /** The node being renamed; null renders nothing. */
  node: FileNode | null;
  onClose: () => void;
  onRename: (node: FileNode, name: string) => Promise<boolean>;
};

export function RenameDialog({ node, onClose, onRename }: RenameDialogProps) {
  const titleId = useId();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  // Seed the input from the node on open (render-time adjustment, not an effect).
  if (node && seededFor !== node.id) {
    setSeededFor(node.id);
    setName(node.name);
  }
  if (!node && seededFor !== null) {
    setSeededFor(null);
  }

  const submit = async () => {
    if (!node || !name.trim() || busy) return;
    setBusy(true);
    const renamed = await onRename(node, name.trim());
    setBusy(false);
    if (renamed) {
      onClose();
    }
  };

  return (
    <ModalOverlay open={node !== null} onClose={onClose} labelledBy={titleId}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="w-full max-w-sm rounded-panel border border-hairline bg-canvas-raised p-4 shadow-elevation-2"
      >
        <h3 id={titleId} className="text-head font-medium text-primary">
          Rename {node?.kind === "folder" ? "folder" : "file"}
        </h3>
        <div className="mt-3">
          <Field label="Name">
            <TextInput
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onFocus={(event) => event.target.select()}
            />
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!name.trim()}>
            Rename
          </Button>
        </div>
      </form>
    </ModalOverlay>
  );
}
