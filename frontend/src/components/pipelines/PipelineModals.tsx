"use client";

import { forwardRef, useImperativeHandle, useState } from "react";

import { IndexRegistryModal } from "@/components/indexes/IndexRegistryModal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

import { CreatePipelineWizard } from "./CreatePipelineWizard";

import type {
  BackendInfo,
  CatalogModel,
  ModelCatalogResponse,
  NodeSpec,
  Pipeline,
  PipelineKind,
  VectorIndex,
} from "@/lib/types";

export type PipelineModalsHandle = {
  openCreatePipeline: () => void;
  openIndexRegistry: (returnToWizard?: boolean) => void;
};

type PipelineModalsProps = {
  kind: PipelineKind;
  token: string;
  indexes: VectorIndex[];
  backends: BackendInfo[];
  nodeSpecs: NodeSpec[];
  embeddingModels: CatalogModel[];
  embeddingCatalog: ModelCatalogResponse | null;
  embeddingModelsLoading: boolean;
  embeddingModelsError: string | null;
  onCatalogVisible: () => void;
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
 * create-pipeline wizard, and the index registry - including the handshake where the
 * wizard's "add a new index" step closes itself, opens the index registry, and reopens
 * once the index registry is dismissed. That handshake is local state here rather than
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
      nodeSpecs,
      embeddingModels,
      embeddingCatalog,
      embeddingModelsLoading,
      embeddingModelsError,
      onCatalogVisible,
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
    const [showIndexRegistry, setShowIndexRegistry] = useState(false);
    const [returnToPipelineWizard, setReturnToPipelineWizard] = useState(false);

    useImperativeHandle(
      ref,
      () => ({
        openCreatePipeline: () => setShowCreatePipeline(true),
        openIndexRegistry: (returnToWizard) => {
          setShowIndexRegistry(true);
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
          nodeSpecs={nodeSpecs}
          embeddingModels={embeddingModels}
          embeddingCatalog={embeddingCatalog}
          embeddingModelsLoading={embeddingModelsLoading}
          embeddingModelsError={embeddingModelsError}
          onCatalogVisible={onCatalogVisible}
          onClose={() => setShowCreatePipeline(false)}
          onCreated={onPipelineCreated}
          onOpenIndexRegistry={() => {
            setShowCreatePipeline(false);
            setShowIndexRegistry(true);
            setReturnToPipelineWizard(true);
          }}
        />
        <IndexRegistryModal
          open={showIndexRegistry}
          token={token}
          indexes={indexes}
          backends={backends}
          embeddingModels={embeddingModels}
          embeddingCatalog={embeddingCatalog}
          embeddingModelsLoading={embeddingModelsLoading}
          embeddingModelsError={embeddingModelsError}
          onCatalogVisible={onCatalogVisible}
          loading={indexesLoading}
          error={indexesError}
          onClose={() => {
            setShowIndexRegistry(false);
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
