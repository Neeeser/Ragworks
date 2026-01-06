"use client";

import { useParams } from "next/navigation";

import { ChatStudio } from "@/components/chat-studio/ChatStudio";

export default function CollectionChatStudioPage() {
  const params = useParams<{ collectionId: string }>();
  return <ChatStudio initialCollectionId={params.collectionId} />;
}
