"use client";

import { GitFork, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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

import type { PromptContext } from "@/lib/types";

const STUB_BODY = "Write your prompt here.";

type StudioTab = "editor" | "versions" | "test";

/**
 * The prompt studio: library on the left, the selected prompt's editor,
 * version history, and test bench on the right. Every prompt in the app is
 * one of these entities — consumers reference them by id + version.
 */
export function PromptStudio() {
  const { token } = useAuth();
  const studio = usePromptStudio(token);
  const [tab, setTab] = useState<StudioTab>("editor");
  const [createOpen, setCreateOpen] = useState(false);
  const [forkOpen, setForkOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [versionLabel, setVersionLabel] = useState("");

  const { detail } = studio;

  const handleCreate = async (name: string, context: PromptContext) => {
    const created = await studio.handleCreate({ name, context, body: STUB_BODY });
    if (created) setCreateOpen(false);
  };

  const handleFork = async (name: string, context: PromptContext) => {
    const forked = await studio.handleFork({ name, context });
    if (forked) setForkOpen(false);
  };

  const handleSaveVersion = async () => {
    const saved = await studio.handleSaveVersion(versionLabel.trim() || null);
    if (saved) setVersionLabel("");
  };

  return (
    <div className="flex h-full min-h-0 gap-3 p-3">
      <Panel className="hidden w-72 shrink-0 flex-col p-2 lg:flex">
        <PromptLibraryRail
          prompts={studio.prompts}
          loading={studio.promptsLoading}
          selectedId={studio.selectedId}
          onSelect={studio.setSelectedId}
          onCreate={() => setCreateOpen(true)}
        />
      </Panel>

      <Panel className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3">
        <div className="lg:hidden">
          <PromptLibraryRail
            prompts={studio.prompts}
            loading={studio.promptsLoading}
            selectedId={studio.selectedId}
            onSelect={studio.setSelectedId}
            onCreate={() => setCreateOpen(true)}
          />
        </div>
        {studio.detailLoading && !detail ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : detail ? (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <h1 className="text-head font-semibold tracking-[-0.01em] text-primary">
                {detail.name}
              </h1>
              <Chip tone="neutral">{CONTEXT_LABELS[detail.context]}</Chip>
              {detail.source === "shipped" && <Chip tone="neutral">Shipped</Chip>}
              <span className="font-mono text-instrument tabular-nums text-meta">
                v{detail.current_version}
              </span>
              {detail.used_by.length > 0 && (
                <span className="text-instrument text-muted">
                  Used by {detail.used_by.map((usage) => usage.name).join(", ")}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setForkOpen(true)}>
                  <GitFork className="h-3.5 w-3.5" aria-hidden />
                  Fork
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDeleteOpen(true)}
                  aria-label="Delete prompt"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            </div>

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
                <div className="flex shrink-0 items-center gap-2 border-t border-hairline pt-2">
                  <input
                    aria-label="Version label"
                    className="h-8 min-w-0 flex-1 rounded-control border border-hairline bg-surface px-2 text-ui text-body placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
                    placeholder="Version label (optional)"
                    value={versionLabel}
                    onChange={(event) => setVersionLabel(event.target.value)}
                  />
                  <Button
                    size="sm"
                    glow
                    onClick={handleSaveVersion}
                    loading={studio.mutating}
                    disabled={!studio.hasChanges || studio.mutating}
                  >
                    Save as v{detail.current_version + 1}
                  </Button>
                </div>
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
          onClose={() => setForkOpen(false)}
          onFork={handleFork}
        />
      )}
      {detail && (
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
