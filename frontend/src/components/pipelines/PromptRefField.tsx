"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { CustomSelect } from "@/components/ui/custom-select";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { getPrompt, listPrompts, listPromptVersions } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { useAuth } from "@/providers/auth-provider";

import type {
  PipelineValidationIssue,
  PromptContext,
  PromptReference,
  PromptVersionSelector,
} from "@/lib/types";

const NODE_PROMPT_CONTEXTS: Record<string, PromptContext> = {
  "llm.transform": "node.transform",
  "llm.rerank": "node.rerank",
  "llm.generate": "node.generate",
};

interface PromptRefFieldProps {
  nodeType: string;
  config: Record<string, unknown>;
  disabled: boolean;
  validationIssues: PipelineValidationIssue[];
  onConfigChange: (config: Record<string, unknown>) => void;
}

function parseRef(config: Record<string, unknown>): PromptReference | null {
  const raw = config.prompt_ref;
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as { prompt_id?: unknown; version?: unknown };
  if (typeof candidate.prompt_id !== "string") return null;
  const version: PromptVersionSelector =
    typeof candidate.version === "number" ? candidate.version : "latest";
  return { prompt_id: candidate.prompt_id, version };
}

/**
 * The node's prompt as a library reference: which prompt, at which version
 * (latest or a pin), with the resolved template previewed in place. Bodies
 * are edited in the prompt studio; picking here never edits text.
 */
export function PromptRefField({
  nodeType,
  config,
  disabled,
  validationIssues,
  onConfigChange,
}: PromptRefFieldProps) {
  const { token } = useAuth();
  const context = NODE_PROMPT_CONTEXTS[nodeType] ?? "node.transform";
  const reference = parseRef(config);
  const [previewBody, setPreviewBody] = useState<string>("");

  const promptsQuery = useApiQuery(
    useCallback(async () => (token ? listPrompts(token, context) : []), [token, context]),
    [token, context],
  );
  const prompts = promptsQuery.data ?? [];
  const selected = prompts.find((prompt) => prompt.id === reference?.prompt_id) ?? null;

  useEffect(() => {
    if (!token || !reference) {
      setPreviewBody("");
      return;
    }
    let cancelled = false;
    const load =
      reference.version === "latest"
        ? getPrompt(token, reference.prompt_id).then((detail) => detail.body)
        : listPromptVersions(token, reference.prompt_id).then(
            (versions) => versions.find((entry) => entry.version === reference.version)?.body ?? "",
          );
    load
      .then((body) => {
        if (!cancelled) setPreviewBody(body);
      })
      .catch(() => {
        if (!cancelled) setPreviewBody("");
      });
    return () => {
      cancelled = true;
    };
    // reference is re-derived per render; its identity fields drive the load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, reference?.prompt_id, reference?.version]);

  const setReference = (next: PromptReference) => {
    onConfigChange({
      ...config,
      prompt_ref: { prompt_id: next.prompt_id, version: next.version },
      // References replace inline text; the resolver fills these at run time.
      prompt: "",
      system_prompt: "",
    });
  };

  const issue = validationIssues.find((entry) => entry.field === "prompt_ref")?.message ?? null;
  const inlinePrompt = typeof config.prompt === "string" ? config.prompt : "";
  const maxVersion = selected?.current_version ?? 1;
  const versionOptions = [
    { value: "latest", label: `latest (v${maxVersion})` },
    ...Array.from({ length: maxVersion }, (_, index) => maxVersion - index).map((version) => ({
      value: String(version),
      label: `v${version}`,
    })),
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <InstrumentLabel>Prompt</InstrumentLabel>
          <CustomSelect
            aria-label="Prompt"
            value={reference?.prompt_id ?? ""}
            placeholder="Pick a prompt"
            disabled={disabled}
            options={prompts.map((prompt) => ({ value: prompt.id, label: prompt.name }))}
            onValueChange={(promptId) => setReference({ prompt_id: promptId, version: "latest" })}
          />
        </div>
        <div className="w-32 shrink-0 space-y-1">
          <InstrumentLabel>Version</InstrumentLabel>
          <CustomSelect
            aria-label="Prompt version"
            value={reference ? String(reference.version) : "latest"}
            placeholder="latest"
            disabled={disabled || !reference}
            options={versionOptions}
            onValueChange={(value) =>
              reference &&
              setReference({
                prompt_id: reference.prompt_id,
                version: value === "latest" ? "latest" : Number(value),
              })
            }
          />
        </div>
      </div>
      {issue && (
        <p role="alert" className="text-instrument text-data-neg">
          {issue}
        </p>
      )}
      {reference && selected && (
        <Link
          href={`/prompts?prompt=${selected.id}`}
          className="inline-flex items-center gap-1 text-instrument text-accent-cyan hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
        >
          Edit in prompt studio
          <ExternalLink className="h-3 w-3" aria-hidden />
        </Link>
      )}
      {(previewBody || inlinePrompt) && (
        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-control border border-hairline bg-surface p-2 font-mono text-instrument text-body">
          {previewBody || inlinePrompt}
        </pre>
      )}
      {!reference && inlinePrompt && (
        <p className="text-instrument text-meta">
          This node carries inline prompt text from an older version. Pick a library prompt to
          replace it.
        </p>
      )}
    </div>
  );
}
