/**
 * Frontend observability: request correlation and safe error presentation.
 *
 * The single owner of request-ID generation/propagation, the client error
 * buffer, and the user diagnostics report. Its role is correlation only — it
 * adds no analytics, user-action tracking, remote error shipping, or payload
 * capture. Features import from here rather than generating request IDs or
 * formatting support references themselves.
 */

export { REQUEST_ID_HEADER, generateRequestId } from "@/lib/observability/request-id";
export {
  clearObservabilityEntries,
  getObservabilityEntries,
  installClientErrorCapture,
  recordApiError,
  recordClientError,
  type ObservabilityEntry,
} from "@/lib/observability/error-buffer";
export {
  buildDiagnosticsReport,
  downloadDiagnosticsReport,
  type DiagnosticsReport,
} from "@/lib/observability/report";
