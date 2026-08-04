"use client";

import { Play } from "lucide-react";
import { useState } from "react";

import { ModelPickerField } from "@/components/models/ModelPickerField";
import { useLlmModelCatalog } from "@/components/pipelines/hooks/use-llm-model-catalog";
import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { MessageStack } from "@/components/ui/message-stack";
import { streamPromptTest } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/providers/auth-provider";

import { isNodeContext } from "./lib/contexts";

import type { UseBenchModelResult } from "./hooks/use-bench-model";
import type { PromptDraft } from "./hooks/use-prompt-studio";
import type { PromptDetail, PromptTestMessage } from "@/lib/types";

interface PromptTestBenchProps {
  detail: PromptDetail;
  draft: PromptDraft;
  /**
   * Owned by the studio, not the bench: this component unmounts whenever the
   * user switches to the editor, so a choice held here is lost on every
   * edit-test cycle.
   */
  bench: UseBenchModelResult;
}

/**
 * What the bench shows for a run — the same shape whether the answer is
 * still arriving or has settled, so a streaming run doesn't render through
 * a second, drifting code path.
 */
interface RunOutcome {
  messages: PromptTestMessage[];
  text: string;
  structured: Record<string, unknown> | null;
}

/**
 * Live execution of the current draft: pick a model, run it, read the exact
 * message payload that was sent and the answer as it streams back.
 * Node-context prompts with output fields run through the same
 * structured-output engine path the pipeline nodes use — the engine returns
 * that whole, so it arrives in one piece rather than token by token.
 */
export function PromptTestBench({ detail, draft, bench }: PromptTestBenchProps) {
  const { model, setModel } = bench;
  const { token, user } = useAuth();
  const { llmModels } = useLlmModelCatalog(token, user?.id);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const structured = isNodeContext(detail.context) && draft.outputFields.length > 0;

  const handleRun = async () => {
    if (!token || !model) return;
    setRunning(true);
    setError(null);
    setOutcome(null);
    try {
      const result = await streamPromptTest(
        token,
        {
          body: draft.body,
          system_body: draft.systemBody || null,
          context: detail.context,
          // The sample values the editor is showing: a test run answers
          // "how does this prompt behave on my data", which it cannot do
          // against the catalog's stock examples.
          values: draft.values,
          connection_id: model.connection_id,
          model_name: model.id,
          output_fields: structured
            ? draft.outputFields.map((field) => ({ ...field, target: { ...field.target } }))
            : [],
        },
        {
          // Paint the payload before the model answers, then each delta as
          // it lands — a slow model reads as progress, not a spinner.
          onStart: (start) => setOutcome({ messages: start.messages, text: "", structured: null }),
          onToken: (content) =>
            setOutcome((previous) =>
              previous ? { ...previous, text: previous.text + content } : previous,
            ),
        },
      );
      setOutcome({
        messages: result.messages,
        text: result.response_text ?? "",
        structured: result.structured_output ?? null,
      });
    } catch (runError) {
      setError(getErrorMessage(runError, "Test run failed."));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <InstrumentLabel>Model</InstrumentLabel>
        {/* Centered, not bottom-aligned: the picker grows to two lines once a
            model is chosen, and an edge-aligned button reads as misplaced
            against a card twice its height. */}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <div className="min-w-64 flex-1">
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
          <Button
            size="sm"
            glow
            className="shrink-0"
            onClick={handleRun}
            loading={running}
            disabled={!model || running}
          >
            <Play className="h-3.5 w-3.5" aria-hidden />
            Run test
          </Button>
        </div>
      </div>
      {structured && (
        <p className="text-instrument text-meta">
          Runs the structured-output engine path against the {draft.outputFields.length} output
          field{draft.outputFields.length === 1 ? "" : "s"} defined in the editor.
        </p>
      )}
      {error && <p className="text-ui text-data-neg">{error}</p>}
      {outcome && (
        <div className="space-y-3">
          <MessageStack label="Sent payload" messages={outcome.messages} defaultView="raw" />
          {outcome.structured ? (
            <div className="space-y-1">
              <span className="text-instrument font-medium text-muted">Structured output</span>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-control border border-hairline bg-surface p-2 font-mono text-instrument text-body">
                {JSON.stringify(outcome.structured, null, 2)}
              </pre>
            </div>
          ) : (
            <MessageStack
              label="Response"
              messages={[{ role: "assistant", content: outcome.text }]}
            />
          )}
        </div>
      )}
    </div>
  );
}
