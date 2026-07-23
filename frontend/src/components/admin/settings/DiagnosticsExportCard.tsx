"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { fetchAdminDiagnostics } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/providers/auth-provider";

/**
 * Admin control to download recent backend log records as a support bundle.
 *
 * Fetches the redacted in-memory log buffer and saves it as JSON to attach to
 * a bug report. Backend-owned copy stays factual — this is operational data,
 * not a product feature.
 */
export function DiagnosticsExportCard() {
  const { token } = useAuth();
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    if (!token) return;
    setDownloading(true);
    setError(null);
    try {
      const bundle = await fetchAdminDiagnostics(token);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ragworks-diagnostics-${bundle.metadata.generated_at.replace(/[:.]/g, "-")}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(getErrorMessage(err, "Could not download diagnostics."));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section aria-labelledby="config-section-diagnostics">
      <h2
        id="config-section-diagnostics"
        className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted"
      >
        Diagnostics
      </h2>
      <div className="mt-2 border-t border-hairline py-5">
        <p className="text-sm text-body">
          Download recent backend log records from this server process. Records are redacted and
          hold no secrets or user content. Attach the file to a bug report.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-data-neg">
            {error}
          </p>
        )}
        <div className="mt-4">
          <Button size="sm" variant="secondary" loading={downloading} onClick={handleDownload}>
            Download diagnostics
          </Button>
        </div>
      </div>
    </section>
  );
}
