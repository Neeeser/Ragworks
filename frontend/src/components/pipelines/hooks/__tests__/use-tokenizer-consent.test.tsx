import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTokenizerConsent } from "@/components/pipelines/hooks/use-tokenizer-consent";
import * as apiModule from "@/lib/api";
import { ApiError } from "@/lib/api-error";

import type { PipelineDefinition } from "@/lib/types";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);
const modelId = "owner/model";
const definition: PipelineDefinition = {
  nodes: [
    {
      id: "chunker",
      type: "chunker.token",
      name: "Token Chunker",
      config: { tokenizer: "huggingface", hf_model_id: modelId },
    },
  ],
  edges: [],
};

describe("useTokenizerConsent", () => {
  beforeEach(() => {
    api.ensureHuggingFaceTokenizer.mockResolvedValue({
      model_id: modelId,
      cached: true,
    });
  });

  it("continues immediately when every tokenizer is already available", async () => {
    const ready = vi.fn(async () => undefined);
    const { result } = renderHook(() => useTokenizerConsent("token", vi.fn()));

    await act(() => result.current.ensureThen(definition, ready));

    expect(api.ensureHuggingFaceTokenizer).toHaveBeenCalledWith("token", {
      model_id: modelId,
    });
    expect(ready).toHaveBeenCalledTimes(1);
    expect(result.current.modelId).toBeNull();
  });

  it("pauses for consent then downloads and resumes the save", async () => {
    api.ensureHuggingFaceTokenizer
      .mockRejectedValueOnce(new ApiError(400, "Download consent is required."))
      .mockResolvedValue({ model_id: modelId, cached: true });
    const ready = vi.fn(async () => undefined);
    const setMessage = vi.fn();
    const { result } = renderHook(() => useTokenizerConsent("token", setMessage));

    await act(() => result.current.ensureThen(definition, ready));
    expect(result.current.modelId).toBe(modelId);
    expect(ready).not.toHaveBeenCalled();

    act(() => result.current.setRemember(true));
    await act(() => result.current.confirm());

    await waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
    expect(api.ensureHuggingFaceTokenizer).toHaveBeenLastCalledWith("token", {
      model_id: modelId,
      consent: true,
      remember: true,
    });
    expect(result.current.modelId).toBeNull();
  });

  it("surfaces a confirmed download failure", async () => {
    api.ensureHuggingFaceTokenizer
      .mockRejectedValueOnce(new ApiError(400, "Download consent is required."))
      .mockRejectedValueOnce(new ApiError(502, "Tokenizer host unavailable."));
    const setMessage = vi.fn();
    const { result } = renderHook(() => useTokenizerConsent("token", setMessage));

    await act(() => result.current.ensureThen(definition, vi.fn()));
    await act(() => result.current.confirm());

    expect(setMessage).toHaveBeenCalledWith("Tokenizer host unavailable.");
    expect(result.current.modelId).toBe(modelId);
  });

  it("does not request consent for another bad-request error", async () => {
    api.ensureHuggingFaceTokenizer.mockRejectedValueOnce(
      new ApiError(400, "HuggingFace model id is invalid."),
    );
    const ready = vi.fn(async () => undefined);
    const setMessage = vi.fn();
    const { result } = renderHook(() => useTokenizerConsent("token", setMessage));

    await act(() => result.current.ensureThen(definition, ready));

    expect(result.current.modelId).toBeNull();
    expect(ready).not.toHaveBeenCalled();
    expect(setMessage).toHaveBeenCalledWith("HuggingFace model id is invalid.");
  });
});
