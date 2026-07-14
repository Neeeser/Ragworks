"use client";

import { Plus, X } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { modelAvailability } from "@/lib/model-catalog-cache";
import { cn } from "@/lib/utils";

import { getNodeFamilyLabel, getNodeFamilyStyles, resolveNodeFamily } from "./lib/pipeline-theme";
import { NodeConfigSections, NodeDescription, NodeExampleSection } from "./NodeConfigSections";

import type { NodeConfigSectionsProps } from "./NodeConfigSections";
import type { PipelineNodeData } from "./PipelineNode";
import type { CatalogModel } from "@/lib/types";
import type { Node } from "@xyflow/react";

export type NodeEdits = {
  label: string;
  config: Record<string, unknown>;
};

type SectionCatalogProps = Omit<
  NodeConfigSectionsProps,
  "node" | "onConfigChange" | "onSelectEmbeddingModel"
>;

type NodeEditorDrawerProps = SectionCatalogProps & {
  node: Node<PipelineNodeData> | null;
  onClose: () => void;
  /** Applies the drawer's local draft (label + config) to the canvas node. */
  onApply: (nodeId: string, edits: NodeEdits) => void;
  /** Preview mode only: add the previewed node to the canvas. */
  onAddToCanvas?: () => void;
};

const sameConfig = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * The drawer's editing surface for one node. Edits accumulate in a local
 * draft; "Save node" applies them to the canvas (a local save -- the pipeline
 * itself is only committed by the top-bar Save version). Closing with unsaved
 * draft edits asks for confirmation so a stray backdrop click can't lose them.
 * Keyed by node id from the parent so a node switch resets the draft.
 */
function DrawerContent({
  node,
  onClose,
  onApply,
  onAddToCanvas,
  isPreview,
  ...catalogProps
}: NodeEditorDrawerProps & { node: Node<PipelineNodeData> }) {
  const labelId = useId();
  const [draftLabel, setDraftLabel] = useState(node.data.label);
  const [draftConfig, setDraftConfig] = useState<Record<string, unknown>>(
    () => node.data.config ?? {},
  );
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  const dirty =
    !isPreview &&
    (draftLabel !== node.data.label || !sameConfig(draftConfig, node.data.config ?? {}));
  const selectedEmbeddingConnectionId =
    typeof draftConfig.connection_id === "string" ? draftConfig.connection_id : null;
  const selectedEmbeddingModelId =
    typeof draftConfig.model_name === "string" ? draftConfig.model_name : null;
  const embeddingSelectionMissing =
    node.data.nodeType === "embedder.text" &&
    modelAvailability(
      catalogProps.embeddingCatalog,
      selectedEmbeddingConnectionId,
      selectedEmbeddingModelId,
    ) === "missing";

  const draftNode: Node<PipelineNodeData> = {
    ...node,
    data: { ...node.data, label: draftLabel, config: draftConfig },
  };

  const handleSelectEmbeddingModel = (model: CatalogModel) => {
    // Deliberately set only the connection + model — and clear any stored
    // dimension: an explicit `dimension` is sent to the provider as a
    // `dimensions` override, which most embedding models reject (no
    // matryoshka support). Models emit their native size without it.
    setDraftConfig((prev) => {
      const next: Record<string, unknown> = {
        ...prev,
        connection_id: model.connection_id,
        model_name: model.id,
      };
      delete next.dimension;
      return next;
    });
  };

  const handleSave = () => {
    if (embeddingSelectionMissing) return;
    onApply(node.id, { label: draftLabel, config: draftConfig });
    onClose();
  };

  const requestClose = () => {
    if (dirty) {
      setConfirmDiscardOpen(true);
    } else {
      onClose();
    }
  };

  const family = resolveNodeFamily(node.data.nodeType);
  const familyStyles = getNodeFamilyStyles(family);

  return (
    <ModalOverlay
      open
      onClose={requestClose}
      labelledBy={labelId}
      backdropClassName="items-stretch justify-end p-0"
    >
      <div
        className={cn(
          "drawer-slide-in ml-auto flex h-full w-full max-w-[480px] flex-col border-l bg-canvas-raised/95 backdrop-blur",
          familyStyles.border,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-hairline px-6 pb-4 pt-5">
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "font-mono text-[10px] uppercase tracking-[0.28em]",
                familyStyles.badge,
              )}
            >
              {getNodeFamilyLabel(family)}
            </p>
            {isPreview ? (
              <h2 id={labelId} className="mt-1 truncate text-lg font-semibold text-primary">
                {node.data.label}
              </h2>
            ) : (
              <input
                id={labelId}
                aria-label="Node label"
                className="mt-1 w-full rounded-xl border border-transparent bg-transparent text-lg font-semibold text-primary outline-none transition hover:border-hairline focus:border-accent-violet"
                value={draftLabel}
                onChange={(event) => setDraftLabel(event.target.value)}
              />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!isPreview ? (
              <Button size="sm" onClick={handleSave} disabled={!dirty || embeddingSelectionMissing}>
                Save node
              </Button>
            ) : null}
            <button
              type="button"
              aria-label="Close node editor"
              onClick={requestClose}
              className="rounded-full p-1.5 text-muted transition hover:bg-surface hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-violet"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <NodeDescription node={node} />
          <NodeConfigSections
            node={draftNode}
            isPreview={isPreview}
            onConfigChange={setDraftConfig}
            onSelectEmbeddingModel={handleSelectEmbeddingModel}
            {...catalogProps}
          />
          <NodeExampleSection node={node} />
        </div>

        {isPreview ? (
          <div className="border-t border-hairline px-6 py-4">
            <Button className="w-full" onClick={onAddToCanvas}>
              <Plus className="h-4 w-4" />
              Add to canvas
            </Button>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmDiscardOpen}
        title="Discard node edits?"
        description="This node has unsaved edits. Save node keeps them; discarding reverts to the last saved state."
        confirmLabel="Discard edits"
        confirmVariant="danger"
        onConfirm={() => {
          setConfirmDiscardOpen(false);
          onClose();
        }}
        onCancel={() => setConfirmDiscardOpen(false)}
      />
    </ModalOverlay>
  );
}

/**
 * Full-height slide-over for editing one node's configuration. Opens when a
 * canvas node is selected (edit mode) or a library node is clicked (read-only
 * preview with an "Add to canvas" action).
 */
export function NodeEditorDrawer(props: NodeEditorDrawerProps) {
  if (!props.node) return null;
  // Keyed by node id so switching nodes resets the local draft.
  return <DrawerContent key={props.node.id} {...props} node={props.node} />;
}
