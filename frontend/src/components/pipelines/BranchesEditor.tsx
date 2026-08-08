"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";

import { ExpressionInput } from "./ExpressionInput";
import { createId } from "./lib/pipeline-utils";
import { withItemScope } from "./lib/variable-env";

import type { StaticEnvironment } from "./lib/variable-env";
import type { PipelineRouterBranch } from "@/lib/types";

/** Read the router's branch list out of a raw node config. */
export function branchesFromConfig(config: Record<string, unknown>): PipelineRouterBranch[] {
  const raw = config.branches;
  return Array.isArray(raw) ? (raw as PipelineRouterBranch[]) : [];
}

type BranchesEditorProps = {
  branches: PipelineRouterBranch[];
  onChange: (branches: PipelineRouterBranch[]) => void;
  env: StaticEnvironment;
  disabled: boolean;
};

/** Move the entry at `index` by `offset`, or return the list unchanged at an end. */
function reordered(
  branches: PipelineRouterBranch[],
  index: number,
  offset: number,
): PipelineRouterBranch[] {
  const target = index + offset;
  if (target < 0 || target >= branches.length) return branches;
  const next = [...branches];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** What a control calls a branch: its name, falling back to its position —
 * mirrors `branch_label` in `app/pipelines/nodes/routing.py`. */
const branchLabel = (branch: PipelineRouterBranch, index: number) =>
  branch.name.trim() || `branch ${index + 1}`;

/**
 * Edits the router's branches: each one an output port and the test that
 * fills it. Order is the semantics — branches are tried top to bottom — so
 * the rows reorder in place rather than only being added and removed.
 *
 * A branch's `id` is minted once and never edited: it is what the output port
 * key is built from, so rewriting it would disconnect every edge already
 * drawn to that branch. Renaming only changes the port's label.
 */
export function BranchesEditor({ branches, onChange, env, disabled }: BranchesEditorProps) {
  const itemEnv = withItemScope(env);
  const update = (index: number, patch: Partial<PipelineRouterBranch>) => {
    onChange(branches.map((branch, i) => (i === index ? { ...branch, ...patch } : branch)));
  };

  return (
    <div className="space-y-2">
      <InstrumentLabel className="text-body">Branches</InstrumentLabel>
      <p className="max-w-[66ch] text-ui text-muted">
        Each branch is an output port carrying a test over the item. Branches are tried top to
        bottom and the first one that holds takes the item; the rest leave through Unmatched.
      </p>
      {branches.map((branch, index) => {
        const label = branchLabel(branch, index);
        return (
          <div
            key={branch.id}
            // Grouped and named by position: every row's fields are spelled
            // the same, so without a per-row name a screen reader announces
            // several identical "Name" boxes with nothing to tell them apart.
            // The position is what stays stable while the name is being typed.
            role="group"
            aria-label={`Branch ${index + 1}`}
            className="space-y-2 rounded-control border border-hairline bg-surface p-3"
          >
            <div className="flex items-end gap-2">
              <Field label="Name" className="min-w-0 flex-1">
                <TextInput
                  value={branch.name}
                  disabled={disabled}
                  onChange={(event) => update(index, { name: event.target.value })}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || index === 0}
                aria-label={`Move ${label} up`}
                onClick={() => onChange(reordered(branches, index, -1))}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || index === branches.length - 1}
                aria-label={`Move ${label} down`}
                onClick={() => onChange(reordered(branches, index, 1))}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={`Delete ${label}`}
                onClick={() => onChange(branches.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <ExpressionInput
              aria-label={`Expression for ${label}`}
              value={branch.expression}
              onChange={(expression) => update(index, { expression })}
              env={itemEnv}
              expectedType="boolean"
              placeholder="item.has_image"
            />
          </div>
        );
      })}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() =>
          onChange([
            ...branches,
            { id: createId(), name: `Branch ${branches.length + 1}`, expression: "" },
          ])
        }
      >
        Add branch
      </Button>
    </div>
  );
}
