"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import { fetchEvalRunComparison, fetchEvalRuns } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { useAuth } from "@/providers/auth-provider";

/**
 * Which two runs are being compared, and the diff between them.
 *
 * The pair is state seeded once from `?a=&b=`, and every change writes the URL
 * back so a comparison is linkable — re-reading the params each render would
 * let the deep link overwrite the run the user just picked.
 */
export function useRunComparison() {
  const { token } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [runAId, setRunAId] = useState(() => searchParams?.get("a") ?? null);
  const [runBId, setRunBId] = useState(() => searchParams?.get("b") ?? null);

  const runs = useApiQuery(() => fetchEvalRuns(token!), [token], { enabled: !!token });

  const paired = !!runAId && !!runBId && runAId !== runBId;
  const comparison = useApiQuery(
    () => fetchEvalRunComparison(token!, runAId!, runBId!),
    [token, runAId, runBId],
    { enabled: !!token && paired },
  );

  const select = useCallback(
    (side: "a" | "b", runId: string) => {
      const nextA = side === "a" ? runId : runAId;
      const nextB = side === "b" ? runId : runBId;
      if (side === "a") setRunAId(runId);
      else setRunBId(runId);
      const query = new URLSearchParams();
      if (nextA) query.set("a", nextA);
      if (nextB) query.set("b", nextB);
      router.replace(`/evals/compare?${query}`);
    },
    [runAId, runBId, router],
  );

  return { runs, comparison, runAId, runBId, paired, select };
}
