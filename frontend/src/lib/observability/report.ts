/**
 * User-facing diagnostics report builder.
 *
 * Assembles the client-side correlation buffer plus minimal environment
 * context into a JSON blob a user can download and attach to a bug report. It
 * contains no credentials, request bodies, or response payloads — only the
 * request IDs and error metadata an operator needs to find the matching
 * backend logs.
 */

import { getObservabilityEntries, type ObservabilityEntry } from "@/lib/observability/error-buffer";

export interface DiagnosticsReport {
  generatedAt: string;
  appVersion?: string;
  userAgent: string;
  currentPath: string;
  entries: ObservabilityEntry[];
}

/** Build the report object from the current client state. */
export function buildDiagnosticsReport(appVersion?: string): DiagnosticsReport {
  return {
    generatedAt: new Date().toISOString(),
    appVersion,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
    currentPath: typeof window !== "undefined" ? window.location.pathname : "unknown",
    entries: getObservabilityEntries(),
  };
}

/** Trigger a browser download of the report as a JSON file. */
export function downloadDiagnosticsReport(appVersion?: string): void {
  const report = buildDiagnosticsReport(appVersion);
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ragworks-error-report-${report.generatedAt.replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
