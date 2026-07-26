"use client";

import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildCollectionsQuery } from "@/components/chat-studio/lib/chat-helpers";

interface UseChatSessionRoutingResult {
  activeSessionId: string | null;
  setActiveSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  sessionIdParam: string | null;
  urlCollectionsValue: string | null;
  buildChatUrl: (sessionId: string | null, collectionIds: string[]) => string;
  currentUrl: string;
  navigateToChat: (sessionId: string | null, collectionIds: string[]) => void;
  /** Replaces the current URL (no history entry) when `target` differs from it. */
  replaceUrl: (target: string) => void;
}

/**
 * Bridges the Next.js route (`/chat/[sessionId]?collections=...`) and the studio's
 * active-session state. Owns `activeSessionId`, URL construction, and the effect that
 * reconciles the URL-driven param with local state once a pushed navigation lands.
 */
export function useChatSessionRouting(): UseChatSessionRoutingResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useParams<{ sessionId?: string | string[] }>();
  const rawSessionId = params.sessionId;
  const sessionIdParam = Array.isArray(rawSessionId)
    ? (rawSessionId[0] ?? null)
    : (rawSessionId ?? null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(sessionIdParam);
  const pendingUrlSessionRef = useRef<{ value: string | null; active: boolean }>({
    value: null,
    active: false,
  });
  // Deep links are written comma-separated (`buildCollectionsQuery`), but a
  // hand-built or framework-rewritten URL can repeat the key instead; reading
  // only the first value would silently drop every collection after it.
  const collectionsParams = searchParams.getAll("collections");
  const urlCollectionsValue = collectionsParams.length > 0 ? collectionsParams.join(",") : null;

  const buildChatUrl = useCallback((sessionId: string | null, collectionIds: string[]) => {
    const basePath = sessionId ? `/chat/${sessionId}` : "/chat";
    const query = buildCollectionsQuery(collectionIds);
    return query ? `${basePath}?${query}` : basePath;
  }, []);

  const currentUrl = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  const navigateToChat = useCallback(
    (sessionId: string | null, collectionIds: string[]) => {
      const target = buildChatUrl(sessionId, collectionIds);
      if (target !== currentUrl) {
        pendingUrlSessionRef.current = { value: sessionId, active: true };
        setActiveSessionId(sessionId);
        router.push(target);
        return;
      }
      if (sessionId !== activeSessionId) {
        setActiveSessionId(sessionId);
      }
    },
    [activeSessionId, buildChatUrl, currentUrl, router],
  );

  const replaceUrl = useCallback(
    (target: string) => {
      if (target !== currentUrl) {
        router.replace(target);
      }
    },
    [currentUrl, router],
  );

  useEffect(() => {
    const pending = pendingUrlSessionRef.current;
    if (pending.active) {
      if (sessionIdParam === pending.value) {
        pendingUrlSessionRef.current = { value: null, active: false };
      } else {
        return;
      }
    }
    if (sessionIdParam !== activeSessionId) {
      setActiveSessionId(sessionIdParam);
    }
  }, [activeSessionId, sessionIdParam]);

  return {
    activeSessionId,
    setActiveSessionId,
    sessionIdParam,
    urlCollectionsValue,
    buildChatUrl,
    currentUrl,
    navigateToChat,
    replaceUrl,
  };
}
