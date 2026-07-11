// Preview-kind resolution: which safe renderer handles a file, decided by
// content type first, extension as fallback. Anything unresolved gets the
// metadata card + download — never a faked or unsafe preview (HTML and SVG
// are shown as source/image only, never executed).

import type { FileNode } from "@/lib/types";

export type PreviewKind =
  | "text"
  | "markdown"
  | "json"
  | "table"
  | "image"
  | "pdf"
  | "audio"
  | "video"
  | "none";

/** Text previews are capped; larger files offer download instead. */
export const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

const CODE_EXTENSIONS = new Set([
  "bash",
  "c",
  "cc",
  "cfg",
  "clj",
  "cpp",
  "cs",
  "css",
  "dart",
  "diff",
  "dockerfile",
  "env",
  "ex",
  "fish",
  "go",
  "gradle",
  "graphql",
  "h",
  "hpp",
  "hs",
  "html",
  "ini",
  "java",
  "js",
  "jsx",
  "kt",
  "less",
  "lock",
  "log",
  "lua",
  "makefile",
  "mjs",
  "patch",
  "php",
  "pl",
  "properties",
  "proto",
  "py",
  "r",
  "rb",
  "rs",
  "sass",
  "scala",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "tf",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

const AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav"]);
const VIDEO_EXTENSIONS = new Set(["m4v", "mov", "mp4", "webm"]);
const TABLE_EXTENSIONS = new Set(["csv", "tsv"]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? name.toLowerCase() : name.slice(dot + 1).toLowerCase();
}

// Ordered matchers: the first whose content-type or extension rule hits wins.
const MATCHERS: Array<{
  kind: PreviewKind;
  types?: Set<string>;
  typePrefix?: string;
  extensions: Set<string>;
}> = [
  { kind: "pdf", types: new Set(["application/pdf"]), extensions: new Set(["pdf"]) },
  { kind: "image", typePrefix: "image/", extensions: IMAGE_EXTENSIONS },
  { kind: "audio", typePrefix: "audio/", extensions: AUDIO_EXTENSIONS },
  { kind: "video", typePrefix: "video/", extensions: VIDEO_EXTENSIONS },
  {
    kind: "table",
    types: new Set(["text/csv", "text/tab-separated-values"]),
    extensions: TABLE_EXTENSIONS,
  },
  {
    kind: "markdown",
    types: new Set(["text/markdown"]),
    extensions: new Set(["md", "markdown"]),
  },
  {
    kind: "json",
    types: new Set(["application/json"]),
    extensions: new Set(["json", "jsonl"]),
  },
  { kind: "text", typePrefix: "text/", extensions: CODE_EXTENSIONS },
];

export function resolvePreviewKind(node: FileNode): PreviewKind {
  if (node.kind !== "file") {
    return "none";
  }
  const type = (node.content_type ?? "").toLowerCase();
  const extension = extensionOf(node.name);
  for (const matcher of MATCHERS) {
    const typeHit =
      matcher.types?.has(type) ||
      (matcher.typePrefix !== undefined && type.startsWith(matcher.typePrefix));
    if (typeHit || matcher.extensions.has(extension)) {
      return matcher.kind;
    }
  }
  return "none";
}
