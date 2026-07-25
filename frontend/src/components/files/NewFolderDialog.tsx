"use client";

import { NamePromptDialog } from "@/components/ui/name-prompt-dialog";

type NewFolderDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<boolean>;
};

export function NewFolderDialog({ open, onClose, onCreate }: NewFolderDialogProps) {
  return (
    <NamePromptDialog
      open={open}
      title="New folder"
      submitLabel="Create"
      placeholder="reports"
      onClose={onClose}
      onSubmit={onCreate}
    />
  );
}
