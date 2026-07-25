"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/providers/auth-provider";

import type { ReactNode } from "react";

/**
 * Client-side gate for admin routes; the API is the real enforcement.
 *
 * Chrome-free on purpose: each admin page renders its own `CrumbBar` and the
 * shared `AdminTabs` strip, so the page owns the top bar's state and actions.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user && user.role !== "admin") {
      router.replace("/dashboard");
    }
  }, [loading, user, router]);

  if (!user || user.role !== "admin") {
    return null;
  }
  return <>{children}</>;
}
