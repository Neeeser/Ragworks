"use client";

import { useEffect, useState } from "react";

import { resolvePreviewKind, TEXT_PREVIEW_MAX_BYTES } from "@/components/files/lib/preview";
import { Markdown } from "@/components/ui/markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchFileBlob } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { formatBytes } from "@/lib/format";

import type { PreviewKind } from "@/components/files/lib/preview";
import type { FileNode } from "@/lib/types";

const TEXTUAL_KINDS: ReadonlySet<PreviewKind> = new Set(["text", "markdown", "json", "table"]);

/** Widths that read as lines of prose rather than a progress bar. */
const SKELETON_LINES = ["w-full", "w-11/12", "w-4/5", "w-full", "w-3/4", "w-5/6", "w-2/3"];

type LoadedPreview =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "media"; objectUrl: string }
  | { state: "text"; text: string };

function parseDelimited(text: string, delimiter: string): string[][] {
  // Preview-grade parsing: enough for well-formed CSV/TSV, not an RFC parser.
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .slice(0, 200)
    .map((line) => line.split(delimiter));
}

function TextualPreview({ kind, text }: { kind: PreviewKind; text: string }) {
  if (kind === "markdown") {
    return <Markdown className="max-w-[66ch]">{text}</Markdown>;
  }
  if (kind === "json") {
    let pretty = text;
    try {
      pretty = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      // Not valid JSON (e.g. JSONL) — show it verbatim.
    }
    return (
      <pre className="whitespace-pre-wrap break-words font-mono text-instrument text-body">
        {pretty}
      </pre>
    );
  }
  if (kind === "table") {
    const delimiter = text.includes("\t") ? "\t" : ",";
    const rows = parseDelimited(text, delimiter);
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left font-mono text-instrument tabular-nums text-body">
          <tbody>
            {rows.map((cells, rowIndex) => (
              // Preview rows are positional and never reorder.

              <tr key={rowIndex} className="border-b border-hairline last:border-b-0">
                {cells.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-2 py-1 align-top">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-instrument text-body">
      {text}
    </pre>
  );
}

/**
 * Fetches the file's bytes (authenticated → object URL) and renders the safe
 * preview for its kind. HTML/SVG are never executed: HTML previews render as
 * source, SVG only through `<img>`. The caller keys this component by node
 * id + updated_at, so a node change remounts it fresh in the loading state.
 */
export function FilePreviewContent({ token, node }: { token: string; node: FileNode }) {
  const kind = resolvePreviewKind(node);
  const textual = TEXTUAL_KINDS.has(kind);
  const oversizedText = textual && node.size_bytes > TEXT_PREVIEW_MAX_BYTES;
  const enabled = kind !== "none" && !oversizedText;
  const [loaded, setLoaded] = useState<LoadedPreview>({ state: "loading" });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    fetchFileBlob(token, node.id)
      .then(async (blob) => {
        if (cancelled) return;
        if (textual) {
          const text = await blob.text();
          if (!cancelled) setLoaded({ state: "text", text });
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ state: "media", objectUrl });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoaded({ state: "error", message: getErrorMessage(error, "Unable to load preview.") });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [enabled, node.id, node.updated_at, textual, token]);

  if (kind === "none" || oversizedText) {
    return (
      <p className="text-ui text-muted">
        {oversizedText
          ? `Too large to preview (${formatBytes(node.size_bytes)}) — download it instead.`
          : "No preview for this file type — download it to view."}
      </p>
    );
  }
  if (loaded.state === "loading") {
    // Lines at the geometry the text will occupy, so bytes landing reflows nothing.
    return (
      <div aria-busy className="space-y-2">
        {SKELETON_LINES.map((width, line) => (
          <div key={`${width}-${line}`} className="flex items-center text-ui">
            <Skeleton className={`h-2 ${width}`} />
          </div>
        ))}
        <span className="sr-only">Loading preview</span>
      </div>
    );
  }
  if (loaded.state === "error") {
    return <p className="text-ui text-data-neg">{loaded.message}</p>;
  }
  if (loaded.state === "text") {
    return <TextualPreview kind={kind} text={loaded.text} />;
  }

  const { objectUrl } = loaded;
  if (kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- blob URLs can't go through next/image
      <img
        src={objectUrl}
        alt={node.name}
        className="max-h-[60vh] w-full rounded-control object-contain"
      />
    );
  }
  if (kind === "pdf") {
    return (
      <iframe
        src={objectUrl}
        title={node.name}
        className="h-[60vh] w-full rounded-control border border-hairline"
      />
    );
  }
  if (kind === "audio") {
    return <audio src={objectUrl} controls className="w-full" />;
  }

  return (
    <video src={objectUrl} controls className="max-h-[60vh] w-full rounded-control bg-canvas" />
  );
}
