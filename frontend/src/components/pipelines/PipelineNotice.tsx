"use client";

import { GlassCard } from "@/components/ui/panel";

type PipelineNoticeProps = {
  message: string;
};

export function PipelineNotice({ message }: PipelineNoticeProps) {
  return (
    <GlassCard className="rounded-3xl border border-white/10 p-4 text-sm text-slate-200">
      {message}
    </GlassCard>
  );
}
