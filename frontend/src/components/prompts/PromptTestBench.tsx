"use client";

import { Play } from "lucide-react";
import { useState } from "react";

import { ModelPickerField } from "@/components/models/ModelPickerField";
import { useLlmModelCatalog } from "@/components/pipelines/hooks/use-llm-model-catalog";
import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Markdown } from "@/components/ui/markdown";
import { testPrompt } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/providers/auth-provider";

import type { PromptDraft } from "./hooks/use-prompt-studio";
import type { CatalogModel, PromptDetail, PromptTestResult } from "@/lib/types";

interface PromptTestBenchProps {
  detail: PromptDetail;
  draft: PromptDraft;
}

/**
 * Live execution of the current draft: pick a model, run it, read the
 * response. Node-context prompts run through the same structured-output
 * engine path the pipeline nodes use; chat prompts run as a completion
 * with the rendered prompt as the system message.
 */
export function PromptTestBench({ detail, draft }: PromptTestBenchProps) {
  const { token, user } = useAuth();
  const { llmModels } = useLlmModelCatalog(token, user?.id);
  const [model, setModel] = useState<CatalogModel | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PromptTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    if (!token || !model) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const outcome = await testPrompt(token, {
        body: draft.body,
        system_body: draft.systemBody || null,
        context: detail.context,
        connection_id: model.connection_id,
        model_name: model.id,
      });
      setResult(outcome);
    } catch (runError) {
      setError(getErrorMessage(runError, "Test run failed."));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1">
          <InstrumentLabel>Model</InstrumentLabel>
          <ModelPickerField
            kind="chat"
            models={llmModels}
            selectedConnectionId={model?.connection_id ?? null}
            selectedModelId={model?.id ?? null}
            onSelectModel={setModel}
            placeholder="Pick a model"
            aria-label="Test model"
          />
        </div>
        <Button size="sm" glow onClick={handleRun} loading={running} disabled={!model || running}>
          <Play className="h-3.5 w-3.5" aria-hidden />
          Run test
        </Button>
      </div>
      {error && <p className="text-ui text-data-neg">{error}</p>}
      {result && (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          <div>
            <InstrumentLabel>Sent prompt</InstrumentLabel>
            <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-control border border-hairline bg-surface p-2 font-mono text-instrument text-muted">
              {[result.rendered_system, result.rendered].filter(Boolean).join("\n\n")}
            </pre>
          </div>
          <div>
            <InstrumentLabel>Response</InstrumentLabel>
            {result.structured_output ? (
              <pre className="mt-1 overflow-x-auto rounded-control border border-hairline bg-surface p-2 font-mono text-instrument text-body">
                {JSON.stringify(result.structured_output, null, 2)}
              </pre>
            ) : (
              <div className="mt-1 rounded-control border border-hairline bg-surface p-2">
                <Markdown className="max-w-[66ch]">{result.response_text ?? ""}</Markdown>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
