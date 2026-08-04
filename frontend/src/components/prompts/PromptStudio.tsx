"use client";

import { GitFork, Library, Trash2 } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { useBenchModel } from "@/components/prompts/hooks/use-bench-model";
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
import { usageHref } from "./lib/usage";
import { CreatePromptDialog, ForkPromptDialog } from "./PromptDialogs";
import { PromptEditorPanel } from "./PromptEditorPanel";
import { PromptLibraryRail } from "./PromptLibraryRail";
import { PromptTestBench } from "./PromptTestBench";
import { PromptVersionsPanel } from "./PromptVersionsPanel";

import type { PromptContext, PromptDetail, PromptRead, PromptUsage } from "@/lib/types";

const STUB_BODY = "Write your prompt here.";

type StudioTab = "editor" | "versions" | "test";

interface StudioHeaderProps {
  detail: PromptDetail;
  isShipped: boolean;
  onFork: () => void;
  onDelete: () => void;
  onOpenUsage?: OpenUsage;
}

/** The selected prompt's identity row: name, context, version, actions. */
function StudioHeader({ detail, isShipped, onFork, onDelete, onOpenUsage }: StudioHeaderProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <h1 className="text-head font-semibold tracking-[-0.01em] text-primary">{detail.name}</h1>
      <Chip tone="neutral">{CONTEXT_LABELS[detail.context]}</Chip>
      {isShipped && <Chip tone="neutral">Built-in · read-only</Chip>}
      <span className="font-mono text-instrument tabular-nums text-meta">
        v{detail.current_version}
      </span>
      {detail.used_by.length > 0 && (
        <span className="flex flex-wrap items-center gap-1 text-instrument text-muted">
          Used by
          {detail.used_by.map((usage) => (
            <Link
              key={`${usage.kind}-${usage.id}`}
              href={usageHref(usage)}
              // Handled in place wherever the consumer is already on screen —
              // navigating out of the pipeline editor would discard the graph
              // the user is in the middle of editing.
              onClick={(event) => {
                if (onOpenUsage?.(usage)) event.preventDefault();
              }}
              className="text-accent-cyan hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
            >
              {usage.name}
            </Link>
          ))}
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

/** Open a "used by" target without leaving; true when it was handled here. */
export type OpenUsage = (usage: PromptUsage) => boolean;

export interface PromptStudioProps {
  /** Open on this prompt (the pipeline-editor overlay passes the node's). */
  initialPromptId?: string | null;
  /** Mirror the selection into the address bar — the page does, the overlay doesn't. */
  trackUrl?: boolean;
  /**
   * Called with the fork when the user forks. The node drawer uses this to
   * repoint itself, so editing a built-in prompt from a node cannot leave
   * the node still referencing the original.
   */
  onForked?: (fork: PromptRead) => void;
  /**
   * Follow a "used by" entry without navigating. The pipeline editor supplies
   * this so a click on a node it already holds opens that node's drawer
   * instead of a route change; returning false lets the link navigate.
   */
  onOpenUsage?: OpenUsage;
}

/**
 * The prompt studio: library on the left, the selected prompt's editor,
 * version history, and test bench on the right. Every prompt in the app is
 * one of these entities — consumers reference them by id + version. Built-in
 * prompts are read-only; editing one forks it with the draft carried over.
 */
export function PromptStudio({
  initialPromptId,
  trackUrl,
  onForked,
  onOpenUsage,
}: PromptStudioProps = {}) {
  const { token } = useAuth();
  const studio = usePromptStudio(token, { initialPromptId, trackUrl });
  // Above the bench, which unmounts on every switch to the editor.
  const bench = useBenchModel();
  const [tab, setTab] = useState<StudioTab>("editor");
  const [createOpen, setCreateOpen] = useState(false);
  const [forkOpen, setForkOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [versionLabel, setVersionLabel] = useState("");
  // A pending switch away from an edited draft, held until confirmed —
  // the rail is the natural way to compare two prompts, and losing an
  // edit to it silently is the worst thing this page can do.
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(null);

  const { detail } = studio;
  const isShipped = detail?.source === "shipped";

  const selectPrompt = (promptId: string) => {
    setLibraryOpen(false);
    if (studio.hasChanges && promptId !== studio.selectedId) {
      setPendingSelectId(promptId);
      return;
    }
    studio.setSelectedId(promptId);
  };

  const handleCreate = async (name: string, context: PromptContext) => {
    const created = await studio.handleCreate({ name, context, body: STUB_BODY });
    if (created) setCreateOpen(false);
  };

  const handleFork = async (name: string, context: PromptContext) => {
    const forked = await studio.handleFork({ name, context });
    if (forked) {
      setForkOpen(false);
      setTab("editor");
      onForked?.(forked);
    }
  };

  const handleSaveVersion = async () => {
    const saved = await studio.handleSaveVersion(versionLabel.trim() || null);
    if (saved) setVersionLabel("");
  };

  const usageCounts = Object.fromEntries(
    studio.prompts.map((prompt) => [prompt.id, prompt.usage_count]),
  );

  const rail = (
    <PromptLibraryRail
      prompts={studio.prompts}
      loading={studio.promptsLoading}
      selectedId={studio.selectedId}
      usageCounts={usageCounts}
      onSelect={selectPrompt}
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
              onOpenUsage={onOpenUsage}
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
                detail={detail}
                versions={studio.versions}
                currentVersion={detail.current_version}
                onRestore={(version) => {
                  studio.handleRestoreVersion(version);
                  setTab("editor");
                }}
              />
            )}
            {tab === "test" && (
              <PromptTestBench detail={detail} draft={studio.draft} bench={bench} />
            )}
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

      <StudioDialogs
        detail={detail}
        isShipped={isShipped}
        busy={studio.mutating}
        draftChanged={studio.hasChanges}
        createOpen={createOpen}
        forkOpen={forkOpen}
        deleteOpen={deleteOpen}
        pendingSelectId={pendingSelectId}
        onCloseCreate={() => setCreateOpen(false)}
        onCloseFork={() => setForkOpen(false)}
        onCloseDelete={() => setDeleteOpen(false)}
        onCreate={handleCreate}
        onFork={handleFork}
        onDelete={async () => {
          const deleted = await studio.handleDelete();
          if (deleted) setDeleteOpen(false);
        }}
        onCancelSelect={() => setPendingSelectId(null)}
        onConfirmSelect={() => {
          if (pendingSelectId) studio.setSelectedId(pendingSelectId);
          setPendingSelectId(null);
        }}
      />
    </div>
  );
}

interface StudioDialogsProps {
  detail: PromptDetail | null;
  isShipped: boolean;
  busy: boolean;
  draftChanged: boolean;
  createOpen: boolean;
  forkOpen: boolean;
  deleteOpen: boolean;
  pendingSelectId: string | null;
  onCloseCreate: () => void;
  onCloseFork: () => void;
  onCloseDelete: () => void;
  onCreate: (name: string, context: PromptContext) => void;
  onFork: (name: string, context: PromptContext) => void;
  onDelete: () => Promise<void>;
  onCancelSelect: () => void;
  onConfirmSelect: () => void;
}

/** Every modal the studio can raise, kept out of its render body. */
function StudioDialogs({
  detail,
  isShipped,
  busy,
  draftChanged,
  createOpen,
  forkOpen,
  deleteOpen,
  pendingSelectId,
  onCloseCreate,
  onCloseFork,
  onCloseDelete,
  onCreate,
  onFork,
  onDelete,
  onCancelSelect,
  onConfirmSelect,
}: StudioDialogsProps) {
  return (
    <>
      <ConfirmDialog
        open={pendingSelectId !== null}
        title="Discard unsaved changes?"
        description="This prompt has edits that were never saved as a version. Opening another prompt discards them."
        confirmLabel="Discard"
        confirmVariant="danger"
        onCancel={onCancelSelect}
        onConfirm={onConfirmSelect}
      />
      <CreatePromptDialog
        open={createOpen}
        busy={busy}
        onClose={onCloseCreate}
        onCreate={onCreate}
      />
      {detail && (
        <ForkPromptDialog
          key={detail.id}
          open={forkOpen}
          busy={busy}
          sourceName={detail.name}
          sourceContext={detail.context}
          draftChanged={draftChanged}
          onClose={onCloseFork}
          onFork={onFork}
        />
      )}
      {detail && !isShipped && (
        <ConfirmDialog
          open={deleteOpen}
          title="Delete prompt"
          description={`Deletes “${detail.name}” and all of its versions. Anything still referencing it blocks the delete.`}
          confirmLabel="Delete"
          confirmVariant="danger"
          loading={busy}
          onCancel={onCloseDelete}
          onConfirm={onDelete}
        />
      )}
    </>
  );
}
