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
  includeFieldIssues = false,
}: {
  errors: string[];
  issues: PipelineValidationIssue[];
  /**
   * Also render findings that name a field, prefixed by the field key. In the
   * drawer those sit on the field itself; a list outside the form has no field
   * to sit beside, so omitting them there hides the finding entirely.
   */
  includeFieldIssues?: boolean;
}) {
  const scoped = includeFieldIssues ? issues : issues.filter((issue) => !issue.field);
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
          key={`${issue.field ?? ""}-${issue.message}`}
          role={issue.severity === "error" ? "alert" : undefined}
          className={cn(
            "rounded-control border px-3 py-2 text-ui",
            issue.severity === "error"
              ? "border-data-neg/40 bg-data-neg/10 text-data-neg"
              : "border-data-warn/40 bg-data-warn/10 text-data-warn",
          )}
        >
          {/* The field key is an identifier; the message is prose. */}
          {issue.field ? <span className="font-mono">{issue.field}</span> : null}
          {issue.field ? ": " : null}
          {issue.message}
        </p>
      ))}
    </>
  );
}
