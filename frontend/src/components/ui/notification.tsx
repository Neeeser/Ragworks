"use client";

import { Bell, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { GlassCard } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

type NotificationProps = {
  message: string;
  title?: string;
  icon?: ReactNode;
  action?: ReactNode;
  autoDismissMs?: number;
  onDismiss?: () => void;
  className?: string;
};

const DISMISS_ANIMATION_MS = 220;

export function Notification({
  message,
  title,
  icon,
  action,
  autoDismissMs = 4500,
  onDismiss,
  className,
}: NotificationProps) {
  const [closing, setClosing] = useState(false);

  const handleDismiss = useCallback(() => {
    if (!onDismiss || closing) return;
    setClosing(true);
    window.setTimeout(() => onDismiss(), DISMISS_ANIMATION_MS);
  }, [closing, onDismiss]);

  useEffect(() => {
    if (!onDismiss || autoDismissMs <= 0) return;
    const timer = window.setTimeout(() => {
      handleDismiss();
    }, autoDismissMs);
    return () => window.clearTimeout(timer);
  }, [autoDismissMs, handleDismiss, onDismiss]);

  return (
    <GlassCard
      className={cn(
        "flex items-center gap-4 rounded-full border border-white/10 bg-slate-950/85 px-4 py-3 text-slate-100 shadow-[0_18px_40px_rgba(6,9,22,0.45)] backdrop-blur",
        "transition-all duration-200",
        closing ? "opacity-0 -translate-y-1" : "opacity-100 translate-y-0",
        className,
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-violet-200">
        {icon ?? <Bell className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        {title ? <p className="text-sm font-semibold text-white">{title}</p> : null}
        <p className={cn("text-xs text-slate-300", title ? "mt-1" : "")}>{message}</p>
      </div>
      <div className="flex items-center gap-2">
        {action}
        {onDismiss ? (
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss notification"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-slate-300 transition hover:border-white/40 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </GlassCard>
  );
}
