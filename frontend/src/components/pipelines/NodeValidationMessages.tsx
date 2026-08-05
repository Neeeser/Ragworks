"use client";

import { cn } from "@/lib/utils";

import type { PipelineValidationIssue } from "@/lib/types";

/**
 * What the node editor drawer says about the node it has open: the errors
 * its own config produced, then findings about the node that name no field.
 *
 * A modality finding is about how the node is *wired* — nothing it processes
 * can reach it, or what it produces reaches no index — so it has no field to
 * sit beside, and without a node-scoped display it reaches the client and is
 * rendered nowhere.
 */
export function NodeValidationMessages({
  errors,
  issues,
}: {
  errors: string[];
  issues: PipelineValidationIssue[];
}) {
  const scoped = issues.filter((issue) => !issue.field);
  if (errors.length === 0 && scoped.length === 0) return null;
  return (
    <>
      {errors.length > 0 ? (
        <div
          role="alert"
          className="space-y-1 rounded-control border border-data-neg/40 bg-data-neg/10 px-3 py-2 text-ui text-data-neg"
        >
          {errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      ) : null}
      {scoped.map((issue) => (
        <p
          key={issue.message}
          role={issue.severity === "error" ? "alert" : undefined}
          className={cn(
            "rounded-control border px-3 py-2 text-ui",
            issue.severity === "error"
              ? "border-data-neg/40 bg-data-neg/10 text-data-neg"
              : "border-data-warn/40 bg-data-warn/10 text-data-warn",
          )}
        >
          {issue.message}
        </p>
      ))}
    </>
  );
}
