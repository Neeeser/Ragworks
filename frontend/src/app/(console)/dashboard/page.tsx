"use client";

import Link from "next/link";

import { DashboardActivitySection } from "@/components/dashboard/DashboardActivitySection";
import { DashboardOverviewPanels } from "@/components/dashboard/DashboardOverviewPanels";
import { DashboardStatCards } from "@/components/dashboard/DashboardStatCards";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { GlassCard } from "@/components/ui/panel";
import { useAuth } from "@/providers/auth-provider";

import { useDashboardData } from "./use-dashboard-data";

export default function DashboardPage() {
  const { user } = useAuth();
  const {
    loading,
    error,
    collections,
    sessions,
    stats,
    recentDocuments,
    activeCollections,
    pipelineNameById,
  } = useDashboardData();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Dashboard</p>
          <h1 className="text-3xl font-semibold text-white">
            Hello {user?.full_name ?? user?.email}, here&apos;s your telemetry.
          </h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/collections">
            <Button variant="secondary" className="px-6 py-3">
              Manage collections
            </Button>
          </Link>
          <Link href="/chat">
            <Button className="px-6 py-3">Go to chat studio</Button>
          </Link>
        </div>
      </div>

      {loading ? (
        <GlassCard className="flex items-center justify-center rounded-3xl p-10">
          <Loader className="h-6 w-6" />
        </GlassCard>
      ) : error ? (
        <GlassCard className="rounded-3xl p-8 text-sm text-rose-200">{error}</GlassCard>
      ) : (
        <>
          <DashboardStatCards
            collectionCount={collections.length}
            sessionCount={sessions.length}
            stats={stats}
          />
          <DashboardOverviewPanels
            stats={stats}
            collectionCount={collections.length}
            sessionCount={sessions.length}
          />
          <DashboardActivitySection
            recentDocuments={recentDocuments}
            activeCollections={activeCollections}
            pipelineNameById={pipelineNameById}
          />
        </>
      )}
    </div>
  );
}
