import { InstrumentLabel } from "@/components/ui/instrument-label";

import type { FileSummaryShape } from "@/components/traces/values/shape-guards";

/**
 * The file stream a node read: stored paths, content types, and total size.
 * Every parse explanation opens with it, so a node that produced nothing
 * still says which file it was given.
 */
export function FileCard({ file }: { file: FileSummaryShape | null }) {
  const paths = file?.paths ?? [];
  const mediaTypes = file?.media_types ?? [];
  return (
    <div className="rounded-panel border border-hairline bg-surface p-3">
      <InstrumentLabel>Input file</InstrumentLabel>
      {paths.length > 0 ? (
        paths.map((path) => (
          <p key={path} className="mt-1 break-all font-mono text-ui text-primary">
            {path}
          </p>
        ))
      ) : (
        <p className="mt-1 font-mono text-ui text-primary">—</p>
      )}
      <p className="mt-1 font-mono text-instrument text-muted">
        {mediaTypes.length > 0 ? mediaTypes.join(", ") : "Unknown content type"}
        {typeof file?.byte_size === "number" ? ` · ${file.byte_size.toLocaleString()} bytes` : ""}
      </p>
    </div>
  );
}
