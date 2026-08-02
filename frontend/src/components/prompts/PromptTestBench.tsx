"use client";

import { Play } from "lucide-react";
import { useState } from "react";

import { ModelPickerField } from "@/components/models/ModelPickerField";
import { useLlmModelCatalog } from "@/components/pipelines/hooks/use-llm-model-catalog";
import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { MessageStack } from "@/components/ui/message-stack";
import { testPrompt } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/providers/auth-provider";

import { isNodeContext } from "./lib/contexts";

import type { PromptDraft } from "./hooks/use-prompt-studio";
import type { CatalogModel, PromptDetail, PromptTestResult } from "@/lib/types";

interface PromptTestBenchProps {
  detail: PromptDetail;
  draft: PromptDraft;
}

/**
 * Live execution of the current draft: pick a model, run it, read the exact
 * message payload that was sent and what came back. Node-context prompts
 * with output fields run through the same structured-output engine path the
 * pipeline nodes use; everything else runs as a completion.
 */
export function PromptTestBench({ detail, draft }: PromptTestBenchProps) {
  const { token, user } = useAuth();
  const { llmModels } = useLlmModelCatalog(token, user?.id);
  const [model, setModel] = useState<CatalogModel | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PromptTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const structured = isNodeContext(detail.context) && draft.outputFields.length > 0;

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
        output_fields: structured
          ? draft.outputFields.map((field) => ({ ...field, target: { ...field.target } }))
          : [],
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
      {structured && (
        <p className="text-instrument text-meta">
          Runs the structured-output engine path against the {draft.outputFields.length}{" "}
          output field{draft.outputFields.length === 1 ? "" : "s"} defined in the editor.
        </p>
      )}
      {error && <p className="text-ui text-data-neg">{error}</p>}
      {result && (
        <div className="min-h-0 space-y-3 lg:flex-1 lg:overflow-y-auto">
          <MessageStack label="Sent payload" messages={result.messages} defaultView="raw" />
          {result.structured_output ? (
            <div className="space-y-1">
              <span className="text-instrument font-medium text-muted">Structured output</span>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-control border border-hairline bg-surface p-2 font-mono text-instrument text-body">
                {JSON.stringify(result.structured_output, null, 2)}
              </pre>
            </div>
          ) : (
            <MessageStack
              label="Response"
              messages={[{ role: "assistant", content: result.response_text ?? "" }]}
            />
          )}
        </div>
      )}
    </div>
  );
}
