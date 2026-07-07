"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { AdminNav } from "@/components/admin/AdminNav";
import { useAuth } from "@/providers/auth-provider";

import type { ReactNode } from "react";

/** Client-side gate for admin routes; the API is the real enforcement. */
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
  return (
    <div className="space-y-6">
      <AdminNav />
      {children}
    </div>
  );
}
