"use client";

import {
  File,
  FileAudio,
  FileImage,
  FileJson,
  FileText,
  FileVideo,
  Folder,
  Table2,
} from "lucide-react";

import { resolvePreviewKind } from "@/components/files/lib/preview";
import { cn } from "@/lib/utils";

import type { PreviewKind } from "@/components/files/lib/preview";
import type { FileNode } from "@/lib/types";
import type { LucideIcon } from "lucide-react";

const ICONS: Record<PreviewKind, LucideIcon> = {
  text: FileText,
  markdown: FileText,
  json: FileJson,
  table: Table2,
  image: FileImage,
  pdf: FileText,
  audio: FileAudio,
  video: FileVideo,
  none: File,
};

export function FileIcon({ node, className }: { node: FileNode; className?: string }) {
  if (node.kind === "folder") {
    return <Folder className={cn("text-accent-violet", className)} aria-hidden />;
  }
  const Icon = ICONS[resolvePreviewKind(node)];
  return <Icon className={cn("text-muted", className)} aria-hidden />;
}
