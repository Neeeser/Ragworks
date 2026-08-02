"use client";

import { GitFork, Library, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { TabList } from "@/components/ui/tabs";
import { useAuth } from "@/providers/auth-provider";

import { usePromptStudio } from "./hooks/use-prompt-studio";
import { CONTEXT_LABELS } from "./lib/contexts";
import { CreatePromptDialog, ForkPromptDialog } from "./PromptDialogs";
import { PromptEditorPanel } from "./PromptEditorPanel";
import { PromptLibraryRail } from "./PromptLibraryRail";
import { PromptTestBench } from "./PromptTestBench";
import { PromptVersionsPanel } from "./PromptVersionsPanel";

import type { PromptContext, PromptDetail } from "@/lib/types";

const STUB_BODY = "Write your prompt here.";

type StudioTab = "editor" | "versions" | "test";

interface StudioHeaderProps {
  detail: PromptDetail;
  isShipped: boolean;
  onFork: () => void;
  onDelete: () => void;
}

/** The selected prompt's identity row: name, context, version, actions. */
function StudioHeader({ detail, isShipped, onFork, onDelete }: StudioHeaderProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <h1 className="text-head font-semibold tracking-[-0.01em] text-primary">{detail.name}</h1>
      <Chip tone="neutral">{CONTEXT_LABELS[detail.context]}</Chip>
      {isShipped && <Chip tone="neutral">Built-in · read-only</Chip>}
      <span className="font-mono text-instrument tabular-nums text-meta">
        v{detail.current_version}
      </span>
      {detail.used_by.length > 0 && (
        <span className="text-instrument text-muted">
          Used by {detail.used_by.map((usage) => usage.name).join(", ")}
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onFork}>
          <GitFork className="h-3.5 w-3.5" aria-hidden />
          Fork
        </Button>
        {!isShipped && (
          <Button size="sm" variant="ghost" onClick={onDelete} aria-label="Delete prompt">
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}

interface EditorFooterProps {
  isShipped: boolean;
  nextVersion: number;
  versionLabel: string;
  onVersionLabelChange: (label: string) => void;
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  onFork: () => void;
}

/** Save-as-version for owned prompts; fork-and-edit for shipped ones. */
function EditorFooter({
  isShipped,
  nextVersion,
  versionLabel,
  onVersionLabelChange,
  canSave,
  saving,
  onSave,
  onFork,
}: EditorFooterProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-hairline pt-2">
      {isShipped ? (
        <>
          <p className="min-w-0 flex-1 text-instrument text-meta">
            Built-in prompts are read-only — forking makes your draft v1 of a new prompt.
          </p>
          <Button size="sm" glow onClick={onFork}>
            <GitFork className="h-3.5 w-3.5" aria-hidden />
            Fork and edit
          </Button>
        </>
      ) : (
        <>
          <input
            aria-label="Version label"
            className="h-8 min-w-0 flex-1 rounded-control border border-hairline bg-surface px-2 text-ui text-body placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
            placeholder="Version label (optional)"
            value={versionLabel}
            onChange={(event) => onVersionLabelChange(event.target.value)}
          />
          <Button size="sm" glow onClick={onSave} loading={saving} disabled={!canSave || saving}>
            Save as v{nextVersion}
          </Button>
        </>
      )}
    </div>
  );
}

interface LibraryOverlayProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/** The below-`lg` library drawer: the rail inside a modal overlay. */
function LibraryOverlay({ open, onClose, children }: LibraryOverlayProps) {
  const titleId = useId();
  if (!open) return null;
  return (
    <ModalOverlay open onClose={onClose} labelledBy={titleId}>
      <div className="card-surface flex h-[80vh] w-[92vw] max-w-md flex-col gap-2 bg-canvas-raised p-3 shadow-elevation-2">
        <h2
          id={titleId}
          className="shrink-0 text-head font-semibold tracking-[-0.01em] text-primary"
        >
          Prompt library
        </h2>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </ModalOverlay>
  );
}

/**
 * The prompt studio: library on the left, the selected prompt's editor,
 * version history, and test bench on the right. Every prompt in the app is
 * one of these entities — consumers reference them by id + version. Built-in
 * prompts are read-only; editing one forks it with the draft carried over.
 */
export function PromptStudio() {
  const { token } = useAuth();
  const studio = usePromptStudio(token);
  const [tab, setTab] = useState<StudioTab>("editor");
  const [createOpen, setCreateOpen] = useState(false);
  const [forkOpen, setForkOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [versionLabel, setVersionLabel] = useState("");

  const { detail } = studio;
  const isShipped = detail?.source === "shipped";

  const handleCreate = async (name: string, context: PromptContext) => {
    const created = await studio.handleCreate({ name, context, body: STUB_BODY });
    if (created) setCreateOpen(false);
  };

  const handleFork = async (name: string, context: PromptContext) => {
    const forked = await studio.handleFork({ name, context });
    if (forked) {
      setForkOpen(false);
      setTab("editor");
    }
  };

  const handleSaveVersion = async () => {
    const saved = await studio.handleSaveVersion(versionLabel.trim() || null);
    if (saved) setVersionLabel("");
  };

  const rail = (
    <PromptLibraryRail
      prompts={studio.prompts}
      loading={studio.promptsLoading}
      selectedId={studio.selectedId}
      onSelect={(promptId) => {
        studio.setSelectedId(promptId);
        setLibraryOpen(false);
      }}
      onCreate={() => {
        setLibraryOpen(false);
        setCreateOpen(true);
      }}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 lg:flex-row">
      <Panel className="hidden w-72 shrink-0 flex-col p-2 lg:flex">{rail}</Panel>

      <Panel className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <button
          type="button"
          onClick={() => setLibraryOpen(true)}
          className="flex shrink-0 items-center gap-2 rounded-control border border-hairline bg-surface px-2 py-1.5 text-left text-ui text-body transition-colors duration-80 ease-standard hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet lg:hidden"
        >
          <Library className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{detail?.name ?? "Prompt library"}</span>
          <span className="shrink-0 text-instrument text-meta">Library</span>
        </button>
        {studio.detailLoading && !detail ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : detail ? (
          <>
            <StudioHeader
              detail={detail}
              isShipped={isShipped}
              onFork={() => setForkOpen(true)}
              onDelete={() => setDeleteOpen(true)}
            />

            <TabList<StudioTab>
              label="Prompt sections"
              className="max-w-sm"
              tabs={[
                { id: "editor", label: "Editor" },
                { id: "versions", label: `Versions (${studio.versions.length})` },
                { id: "test", label: "Test" },
              ]}
              active={tab}
              onSelect={setTab}
            />

            {studio.error && <p className="text-ui text-data-neg">{studio.error}</p>}

            {tab === "editor" && (
              <>
                <PromptEditorPanel
                  detail={detail}
                  draft={studio.draft}
                  onDraftChange={studio.setDraft}
                  preview={studio.preview}
                  catalog={studio.catalogFor(detail.context)}
                />
                <EditorFooter
                  isShipped={isShipped}
                  nextVersion={detail.current_version + 1}
                  versionLabel={versionLabel}
                  onVersionLabelChange={setVersionLabel}
                  canSave={studio.hasChanges}
                  saving={studio.mutating}
                  onSave={() => void handleSaveVersion()}
                  onFork={() => setForkOpen(true)}
                />
              </>
            )}
            {tab === "versions" && (
              <PromptVersionsPanel
                versions={studio.versions}
                currentVersion={detail.current_version}
                onRestore={(version) => {
                  studio.handleRestoreVersion(version);
                  setTab("editor");
                }}
              />
            )}
            {tab === "test" && <PromptTestBench detail={detail} draft={studio.draft} />}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-ui text-muted">
              {studio.promptsError ?? "Pick a prompt, or create one."}
            </p>
          </div>
        )}
      </Panel>

      <LibraryOverlay open={libraryOpen} onClose={() => setLibraryOpen(false)}>
        {rail}
      </LibraryOverlay>

      <CreatePromptDialog
        open={createOpen}
        busy={studio.mutating}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />
      {detail && (
        <ForkPromptDialog
          key={detail.id}
          open={forkOpen}
          busy={studio.mutating}
          sourceName={detail.name}
          sourceContext={detail.context}
          draftChanged={studio.hasChanges}
          onClose={() => setForkOpen(false)}
          onFork={handleFork}
        />
      )}
      {detail && !isShipped && (
        <ConfirmDialog
          open={deleteOpen}
          title="Delete prompt"
          description={`Deletes “${detail.name}” and all of its versions. Anything still referencing it blocks the delete.`}
          confirmLabel="Delete"
          confirmVariant="danger"
          loading={studio.mutating}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={async () => {
            const deleted = await studio.handleDelete();
            if (deleted) setDeleteOpen(false);
          }}
        />
      )}
    </div>
  );
}
