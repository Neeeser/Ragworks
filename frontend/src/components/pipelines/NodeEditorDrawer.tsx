"use client";

import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { deepEqual } from "@/lib/deep-equal";
import { modelAvailability } from "@/lib/model-catalog-cache";
import { cn } from "@/lib/utils";

import { withNodeConfig } from "./lib/dynamic-ports";
import { getNodeFamilyLabel, getNodeFamilyStyles, resolveNodeFamily } from "./lib/pipeline-theme";
import { RERANKER_NODE_TYPE, RERANKER_PROVIDER_REQUIRED } from "./lib/reranking";
import { NodeConfigSections } from "./NodeConfigSections";
import { NodeDescription, NodeExampleSection } from "./NodeInfoSections";

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
  | "node"
  | "onConfigChange"
  | "onSelectEmbeddingModel"
  | "onSelectRerankingModel"
  | "onSelectLlmModel"
>;

type NodeEditorDrawerProps = SectionCatalogProps & {
  node: Node<PipelineNodeData> | null;
  onClose: () => void;
  /** Applies the drawer's local draft (label + config) to the canvas node. */
  onApply: (nodeId: string, edits: NodeEdits) => void;
  /** Reports the uncommitted draft so live validation sees what is on screen. */
  onDraftChange?: (nodeId: string, config: Record<string, unknown>) => void;
  /** Preview mode only: add the previewed node to the canvas. */
  onAddToCanvas?: () => void;
  hasRerankingProvider: boolean;
  rerankingProviderMessage?: string | null;
};

const providerUnavailableMessage = (message?: string | null) =>
  message ?? RERANKER_PROVIDER_REQUIRED;

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
  onDraftChange,
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
  // Report the draft from the same place it is set, not from an effect: an
  // effect would cascade a parent render after every keystroke's render.
  // Reporting from inside the `setDraftConfig` updater instead would put a
  // parent setState in a state updater, which React may invoke during this
  // component's render (it does on every update under StrictMode) — a
  // set-state-in-render error, and one extra parent update per invocation.
  const updateDraftConfig = (next: Record<string, unknown>) => {
    setDraftConfig(next);
    onDraftChange?.(node.id, next);
  };

  const dirty =
    !isPreview &&
    // Structural comparison, not serialized JSON: a field that clears and
    // re-sets its keys (the index picker deletes `index_name`/`dimension` and
    // appends them back) rebuilds the same config in a different key order,
    // and comparing text calls that a change the user never made.
    (draftLabel !== node.data.label || !deepEqual(draftConfig, node.data.config ?? {}));
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
  const rerankingSelectionMissing =
    node.data.nodeType === RERANKER_NODE_TYPE &&
    modelAvailability(
      catalogProps.rerankingCatalog,
      selectedEmbeddingConnectionId,
      selectedEmbeddingModelId,
    ) === "missing";
  const rerankerUnavailable =
    node.data.nodeType === RERANKER_NODE_TYPE && !catalogProps.hasRerankingProvider;

  const draftNode: Node<PipelineNodeData> = {
    ...node,
    data: withNodeConfig({ ...node.data, label: draftLabel }, draftConfig),
  };

  const handleSelectEmbeddingModel = (model: CatalogModel) => {
    // Deliberately set only the connection + model — and clear any stored
    // dimension: an explicit `dimension` is sent to the provider as a
    // `dimensions` override, which most embedding models reject (no
    // matryoshka support). Models emit their native size without it.
    const next: Record<string, unknown> = {
      ...draftConfig,
      connection_id: model.connection_id,
      model_name: model.id,
    };
    delete next.dimension;
    updateDraftConfig(next);
  };

  const handleSelectRerankingModel = (model: CatalogModel) => {
    updateDraftConfig({ connection_id: model.connection_id, model_name: model.id });
  };

  // LLM nodes carry prompts and output fields beside the model pair — keep
  // them; only the identity fields change.
  const handleSelectLlmModel = (model: CatalogModel) => {
    updateDraftConfig({
      ...draftConfig,
      connection_id: model.connection_id,
      model_name: model.id,
    });
  };

  const handleSave = () => {
    if (embeddingSelectionMissing || rerankingSelectionMissing) return;
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
          // Depth here is the lit surface plus its family-coloured edge — no
          // blur: a data surface behind glass is the wrong material and a real
          // compositing cost on a panel this tall.
          "drawer-slide-in ml-auto flex h-full w-full max-w-[480px] flex-col border-l bg-canvas-raised shadow-elevation-2",
          familyStyles.border,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-hairline p-3">
          <div className="min-w-0 flex-1">
            <p className={cn("text-instrument font-medium", familyStyles.badge)}>
              {getNodeFamilyLabel(family)}
            </p>
            {isPreview ? (
              <h2
                id={labelId}
                className="mt-0.5 truncate text-head font-semibold tracking-[-0.01em] text-primary"
              >
                {node.data.label}
              </h2>
            ) : (
              <input
                id={labelId}
                aria-label="Node label"
                className="mt-0.5 w-full rounded-control border border-transparent bg-transparent px-1 py-0.5 text-head font-semibold tracking-[-0.01em] text-primary outline-none transition-colors duration-80 ease-standard hover:border-hairline focus:border-accent-violet"
                value={draftLabel}
                onChange={(event) => setDraftLabel(event.target.value)}
              />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {!isPreview ? (
              <Button
                size="sm"
                glow
                onClick={handleSave}
                disabled={!dirty || embeddingSelectionMissing || rerankingSelectionMissing}
              >
                Save node
              </Button>
            ) : null}
            <button
              type="button"
              aria-label="Close node editor"
              onClick={requestClose}
              className="rounded-control p-1 text-muted transition-colors duration-80 ease-standard hover:bg-surface hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          <NodeDescription node={node} />
          <NodeConfigSections
            node={draftNode}
            isPreview={isPreview}
            onConfigChange={updateDraftConfig}
            onSelectEmbeddingModel={handleSelectEmbeddingModel}
            onSelectRerankingModel={handleSelectRerankingModel}
            onSelectLlmModel={handleSelectLlmModel}
            {...catalogProps}
          />
          <NodeExampleSection node={node} />
        </div>

        {isPreview ? (
          <div className="border-t border-hairline p-3">
            <Button glow className="w-full" onClick={onAddToCanvas} disabled={rerankerUnavailable}>
              <Plus className="h-4 w-4" aria-hidden />
              Add to canvas
            </Button>
            {rerankerUnavailable ? (
              <p className="mt-2 max-w-[66ch] text-ui text-muted">
                {providerUnavailableMessage(catalogProps.rerankingProviderMessage)}{" "}
                <Link
                  href="/settings"
                  className="rounded-control text-accent-cyan underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
                >
                  Settings
                </Link>
              </p>
            ) : null}
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
