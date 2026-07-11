"use client";

import { useParams } from "next/navigation";

import { FilesPage } from "@/components/files/FilesPage";

export default function CollectionFilesPage() {
  const params = useParams<{ collectionId: string; path?: string[] }>();
  const segments = (params.path ?? []).map((segment) => decodeURIComponent(segment));
  return <FilesPage collectionId={params.collectionId} pathSegments={segments} />;
}
