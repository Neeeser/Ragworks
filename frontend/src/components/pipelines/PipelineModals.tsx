"use client";

import { forwardRef, useImperativeHandle, useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

import { CreatePipelineWizard } from "./CreatePipelineWizard";
import { IndexManagerModal } from "./index-manager/IndexManagerModal";

import type {
  BackendInfo,
  EmbeddingModelInfo,
  Pipeline,
  PipelineKind,
  VectorIndex,
} from "@/lib/types";

export type PipelineModalsHandle = {
  openCreatePipeline: () => void;
  openIndexManager: (returnToWizard?: boolean) => void;
};

type PipelineModalsProps = {
  kind: PipelineKind;
  token: string;
  indexes: VectorIndex[];
  backends: BackendInfo[];
  embeddingModels: EmbeddingModelInfo[];
  embeddingModelsLoading: boolean;
  embeddingModelsError: string | null;
  indexesLoading: boolean;
  indexesError: string | null;
  onRefreshIndexes: () => void;
  onPipelineCreated: (pipeline: Pipeline) => void;
  deleteTarget: Pipeline | null;
  saving: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
};

/**
 * Orchestrates the three pipeline-builder modals: the delete-pipeline confirmation, the
 * create-pipeline wizard, and the index manager - including the handshake where the
 * wizard's "add a new index" step closes itself, opens the index manager, and reopens
 * once the index manager is dismissed. That handshake is local state here rather than
 * lifted to PipelineBuilder since it only concerns transitions between these two
 * modals; callers just imperatively request "open create pipeline" / "open index
 * manager" via the ref handle.
 */
export const PipelineModals = forwardRef<PipelineModalsHandle, PipelineModalsProps>(
  function PipelineModals(
    {
      kind,
      token,
      indexes,
      backends,
      embeddingModels,
      embeddingModelsLoading,
      embeddingModelsError,
      indexesLoading,
      indexesError,
      onRefreshIndexes,
      onPipelineCreated,
      deleteTarget,
      saving,
      onConfirmDelete,
      onCancelDelete,
    },
    ref,
  ) {
    const [showCreatePipeline, setShowCreatePipeline] = useState(false);
    const [showIndexManager, setShowIndexManager] = useState(false);
    const [returnToPipelineWizard, setReturnToPipelineWizard] = useState(false);

    useImperativeHandle(
      ref,
      () => ({
        openCreatePipeline: () => setShowCreatePipeline(true),
        openIndexManager: (returnToWizard) => {
          setShowIndexManager(true);
          if (returnToWizard) {
            setReturnToPipelineWizard(true);
          }
        },
      }),
      [],
    );

    return (
      <>
        <ConfirmDialog
          open={deleteTarget !== null}
          title="Delete pipeline?"
          description={
            deleteTarget
              ? `This will remove "${deleteTarget.name}" and all of its versions. This action cannot be undone.`
              : ""
          }
          confirmLabel="Delete pipeline"
          confirmVariant="danger"
          loading={saving}
          onConfirm={onConfirmDelete}
          onCancel={onCancelDelete}
        />
        <CreatePipelineWizard
          open={showCreatePipeline}
          token={token}
          kind={kind}
          indexes={indexes}
          backends={backends}
          onClose={() => setShowCreatePipeline(false)}
          onCreated={onPipelineCreated}
          onOpenIndexManager={() => {
            setShowCreatePipeline(false);
            setShowIndexManager(true);
            setReturnToPipelineWizard(true);
          }}
        />
        <IndexManagerModal
          open={showIndexManager}
          token={token}
          indexes={indexes}
          backends={backends}
          embeddingModels={embeddingModels}
          embeddingModelsLoading={embeddingModelsLoading}
          embeddingModelsError={embeddingModelsError}
          loading={indexesLoading}
          error={indexesError}
          onClose={() => {
            setShowIndexManager(false);
            if (returnToPipelineWizard) {
              setShowCreatePipeline(true);
              setReturnToPipelineWizard(false);
            }
          }}
          onRefresh={onRefreshIndexes}
        />
      </>
    );
  },
);
