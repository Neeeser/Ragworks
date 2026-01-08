"use client";

import { ChatStudio } from "@/components/chat-studio/ChatStudio";

import type { ReactNode } from "react";

export default function ChatLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ChatStudio />
      {children}
    </>
  );
}
