"use client";

import { CustomSelect } from "@/components/ui/custom-select";
import { Field, TextInput } from "@/components/ui/field";

import type { PipelineValidationIssue } from "@/lib/types";

type ChunkerTokenizerFieldsProps = {
  config: Record<string, unknown>;
  disabled: boolean;
  validationIssues: PipelineValidationIssue[];
  onConfigChange: (config: Record<string, unknown>) => void;
};

const TOKENIZER_OPTIONS = [
  { value: "wordpiece", label: "WordPiece" },
  { value: "cl100k", label: "cl100k" },
  { value: "whitespace", label: "Whitespace" },
  { value: "huggingface", label: "HuggingFace" },
];

/** Edit the tokenizer fields shared by every chunker config model. */
export function ChunkerTokenizerFields({
  config,
  disabled,
  validationIssues,
  onConfigChange,
}: ChunkerTokenizerFieldsProps) {
  const tokenizer = typeof config.tokenizer === "string" ? config.tokenizer : "wordpiece";
  const modelId = typeof config.hf_model_id === "string" ? config.hf_model_id : "";
  const tokenizerIssue = validationIssues.find((issue) => issue.field === "tokenizer");
  const modelIdIssue = validationIssues.find((issue) => issue.field === "hf_model_id");

  const handleTokenizerChange = (value: string) => {
    const nextConfig: Record<string, unknown> = { ...config, tokenizer: value };
    if (value !== "huggingface") delete nextConfig.hf_model_id;
    onConfigChange(nextConfig);
  };

  const handleModelIdChange = (value: string) => {
    const nextConfig = { ...config };
    if (value) nextConfig.hf_model_id = value;
    else delete nextConfig.hf_model_id;
    onConfigChange(nextConfig);
  };

  return (
    <div className="space-y-3 rounded-2xl border border-hairline bg-surface p-3">
      <Field label="Tokenizer" error={tokenizerIssue?.message}>
        <CustomSelect
          value={tokenizer}
          options={TOKENIZER_OPTIONS}
          placeholder="Select a tokenizer"
          disabled={disabled}
          onValueChange={handleTokenizerChange}
        />
      </Field>
      {tokenizer === "huggingface" ? (
        <Field label="HuggingFace model id" error={modelIdIssue?.message}>
          <TextInput
            value={modelId}
            placeholder="owner/model"
            disabled={disabled}
            onChange={(event) => handleModelIdChange(event.target.value)}
          />
        </Field>
      ) : null}
    </div>
  );
}
