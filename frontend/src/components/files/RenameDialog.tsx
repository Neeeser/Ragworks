"use client";

import { NamePromptDialog } from "@/components/ui/name-prompt-dialog";

import type { FileNode } from "@/lib/types";

type RenameDialogProps = {
  /** The node being renamed; null renders nothing. */
  node: FileNode | null;
  onClose: () => void;
  onRename: (node: FileNode, name: string) => Promise<boolean>;
};

export function RenameDialog({ node, onClose, onRename }: RenameDialogProps) {
  return (
    <NamePromptDialog
      open={node !== null}
      title={`Rename ${node?.kind === "folder" ? "folder" : "file"}`}
      submitLabel="Rename"
      initialValue={node?.name ?? ""}
      seedKey={node?.id}
      selectOnFocus
      onClose={onClose}
      onSubmit={(name) => (node ? onRename(node, name) : Promise.resolve(false))}
    />
  );
}
