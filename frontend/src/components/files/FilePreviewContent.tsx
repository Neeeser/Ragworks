"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { markdownComponents } from "@/components/chat-studio/lib/chat-utils";
import { resolvePreviewKind, TEXT_PREVIEW_MAX_BYTES } from "@/components/files/lib/preview";
import { formatBytes } from "@/components/files/lib/tree";
import { Loader } from "@/components/ui/loader";
import { fetchFileBlob } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { PreviewKind } from "@/components/files/lib/preview";
import type { FileNode } from "@/lib/types";

const TEXTUAL_KINDS: ReadonlySet<PreviewKind> = new Set(["text", "markdown", "json", "table"]);

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
    return (
      <div className="space-y-3 text-sm leading-relaxed text-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {text}
        </ReactMarkdown>
      </div>
    );
  }
  if (kind === "json") {
    let pretty = text;
    try {
      pretty = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      // Not valid JSON (e.g. JSONL) — show it verbatim.
    }
    return (
      <pre className="whitespace-pre-wrap break-words font-mono text-xs text-body">{pretty}</pre>
    );
  }
  if (kind === "table") {
    const delimiter = text.includes("\t") ? "\t" : ",";
    const rows = parseDelimited(text, delimiter);
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-body">
          <tbody>
            {rows.map((cells, rowIndex) => (
              // Preview rows are positional and never reorder.

              <tr key={rowIndex} className="border-b border-hairline last:border-b-0">
                {cells.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-2 py-1.5 align-top">
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
  return <pre className="whitespace-pre-wrap break-words font-mono text-xs text-body">{text}</pre>;
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
      <p className="rounded-2xl border border-hairline bg-surface p-4 text-sm text-muted">
        {oversizedText
          ? `Too large to preview (${formatBytes(node.size_bytes)}) — download it instead.`
          : "No preview for this file type — download it to view."}
      </p>
    );
  }
  if (loaded.state === "loading") {
    return (
      <div className="flex items-center justify-center p-10">
        <Loader className="h-5 w-5" />
      </div>
    );
  }
  if (loaded.state === "error") {
    return <p className="text-sm text-data-neg">{loaded.message}</p>;
  }
  if (loaded.state === "text") {
    return <TextualPreview kind={kind} text={loaded.text} />;
  }

  const { objectUrl } = loaded;
  if (kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element -- blob URLs can't go through next/image
    return (
      <img
        src={objectUrl}
        alt={node.name}
        className="max-h-[60vh] w-full rounded-2xl object-contain"
      />
    );
  }
  if (kind === "pdf") {
    return (
      <iframe
        src={objectUrl}
        title={node.name}
        className="h-[60vh] w-full rounded-2xl border border-hairline bg-white"
      />
    );
  }
  if (kind === "audio") {
    return <audio src={objectUrl} controls className="w-full" />;
  }

  return <video src={objectUrl} controls className="max-h-[60vh] w-full rounded-2xl bg-black" />;
}
