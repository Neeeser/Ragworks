"use client";

import { History, Play, SquarePen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { CrumbBar } from "@/components/ui/crumb-bar";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { SectionTabs } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";

import { PIPELINE_KIND_LABELS, PIPELINE_KINDS } from "./lib/pipeline-kinds";

import type { SectionTab } from "@/components/ui/tabs";
import type { PipelineKind } from "@/lib/types";

type PipelineHeaderProps = {
  kind: PipelineKind;
  onCreatePipeline: () => void;
  onOpenIndexRegistry: () => void;
  /** Material changes since the saved revision; drives the pill + save button. */
  unsavedCount: number;
  onOpenSave: () => void;
  onOpenHistory: () => void;
  /** False while no pipeline is selected -- the save/history cluster hides. */
  hasPipeline: boolean;
  /** The open pipeline's name and revision, shown as the bar's live state. */
  pipelineName?: string | null;
  pipelineVersion?: number | null;
  /** Opens the rename prompt; omitted while there is nothing to rename. */
  onRenamePipeline?: () => void;
  /** Opens the run panel over the canvas; omitted for kinds that can't run. */
  onOpenRun?: () => void;
};

const KIND_TABS: SectionTab[] = PIPELINE_KINDS.map((value) => ({
  // The route param stays `retrieval` (persisted URLs); only the label says
  // Tools, which is what these pipelines are called everywhere else.
  href: `/pipelines/${value}`,
  label: PIPELINE_KIND_LABELS[value],
}));

/**
 * The editor's top bar: the breadcrumb path, the open pipeline's live state,
 * and every page-level action — plus the kind tabs, which are routes.
 *
 * The page renders no title block of its own: the crumb path already says
 * where the user is, and the kind is named by its tab.
 */
export function PipelineHeader({
  kind,
  onCreatePipeline,
  onOpenIndexRegistry,
  unsavedCount,
  onOpenSave,
  onOpenHistory,
  hasPipeline,
  pipelineName,
  pipelineVersion,
  onRenamePipeline,
  onOpenRun,
}: PipelineHeaderProps) {
  const dirty = unsavedCount > 0;

  return (
    <>
      <CrumbBar
        crumbs={[{ label: "Pipelines", href: "/pipelines" }, { label: PIPELINE_KIND_LABELS[kind] }]}
        state={
          hasPipeline && pipelineName ? (
            <>
              <InstrumentLabel className="min-w-0 truncate text-body">
                {pipelineName}
              </InstrumentLabel>
              {/* The name is stated here, so this is where renaming it lives —
                  a copied pipeline otherwise keeps its "(copy)" name forever. */}
              {onRenamePipeline ? (
                <Tooltip content="Rename pipeline">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    onClick={onRenamePipeline}
                    aria-label={`Rename ${pipelineName}`}
                  >
                    <SquarePen className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </Tooltip>
              ) : null}
              {typeof pipelineVersion === "number" ? (
                <span className="shrink-0 font-mono text-instrument tabular-nums text-meta">
                  v{pipelineVersion}
                </span>
              ) : null}
              {dirty ? (
                <Chip tone="warn" className="shrink-0">{`${unsavedCount} unsaved`}</Chip>
              ) : null}
            </>
          ) : null
        }
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={onOpenIndexRegistry}>
              Index registry
            </Button>
            {hasPipeline ? (
              <>
                {/* Runs the graph on screen, so it sits beside Save rather
                    than inside it — testing a change is what you do before
                    deciding the change is worth a version. */}
                {onOpenRun ? (
                  <Button size="sm" variant="secondary" onClick={onOpenRun}>
                    <Play className="h-3.5 w-3.5" aria-hidden />
                    Run
                  </Button>
                ) : null}
                <Button size="sm" variant="secondary" onClick={onOpenHistory}>
                  <History className="h-3.5 w-3.5" aria-hidden />
                  History
                </Button>
                {/* Exactly one glowing action at a time: the commit point while
                    there is something to commit, otherwise the way to start a
                    new pipeline. */}
                <Button size="sm" glow={dirty} onClick={onOpenSave} disabled={!dirty}>
                  Save version
                </Button>
              </>
            ) : null}
            <Button size="sm" glow={!dirty} onClick={onCreatePipeline}>
              New pipeline
            </Button>
          </>
        }
      />
      <SectionTabs tabs={KIND_TABS} />
    </>
  );
}
