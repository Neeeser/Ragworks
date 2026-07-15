import { describe, expect, it } from "vitest";

import { huggingFaceTokenizerModelIds } from "@/components/pipelines/lib/tokenizer-consent";

const modelId = "owner/model";
const huggingFaceKind = "huggingface";
const tokenChunkerType = "chunker.token";

describe("huggingFaceTokenizerModelIds", () => {
  it("returns unique configured HuggingFace model ids", () => {
    expect(
      huggingFaceTokenizerModelIds({
        nodes: [
          {
            id: "a",
            type: tokenChunkerType,
            name: "A",
            config: { tokenizer: huggingFaceKind, hf_model_id: modelId },
          },
          {
            id: "b",
            type: "chunker.sentence",
            name: "B",
            config: { tokenizer: "wordpiece", hf_model_id: "ignored/model" },
          },
          {
            id: "c",
            type: "chunker.paragraph",
            name: "C",
            config: { tokenizer: huggingFaceKind, hf_model_id: modelId },
          },
        ],
        edges: [],
      }),
    ).toEqual([modelId]);
  });

  it("ignores blank or non-string model ids", () => {
    expect(
      huggingFaceTokenizerModelIds({
        nodes: [
          {
            id: "a",
            type: tokenChunkerType,
            name: "A",
            config: { tokenizer: huggingFaceKind, hf_model_id: "  " },
          },
          {
            id: "b",
            type: tokenChunkerType,
            name: "B",
            config: { tokenizer: huggingFaceKind, hf_model_id: 42 },
          },
        ],
        edges: [],
      }),
    ).toEqual([]);
  });
});
