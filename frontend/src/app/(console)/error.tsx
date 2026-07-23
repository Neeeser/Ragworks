"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { getRequestId } from "@/lib/errors";
import { downloadDiagnosticsReport, recordClientError } from "@/lib/observability";

/**
 * Console error boundary: a recoverable crash screen that surfaces a support
 * reference. When the failure came from an API call it shows the backend
 * request ID; either way the user can download a diagnostics report to attach
 * to a bug report. No stack traces or payloads are shown to the user.
 */
export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const requestId = getRequestId(error);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    recordClientError(error.message || "Console render error");
  }, [error]);

  async function copyRequestId() {
    if (!requestId) return;
    await navigator.clipboard.writeText(requestId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col items-start gap-4 py-16">
      <h1 className="text-xl font-semibold text-primary">Something went wrong</h1>
      <p className="text-sm text-body">
        The page hit an error. You can retry, or download a diagnostics report and attach it to a
        bug report so the issue can be traced.
      </p>
      {requestId && (
        <div className="flex items-center gap-2 rounded-2xl border border-hairline bg-canvas-raised/60 px-4 py-2">
          <span className="font-mono text-xs text-muted">Request ID</span>
          <span className="font-mono text-xs text-body">{requestId}</span>
          <button
            type="button"
            onClick={copyRequestId}
            aria-label="Copy request ID"
            className="ml-1 text-xs text-accent-violet underline decoration-dotted"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={reset}>
          Try again
        </Button>
        <Button size="sm" variant="secondary" onClick={() => downloadDiagnosticsReport()}>
          Download error report
        </Button>
      </div>
    </div>
  );
}
