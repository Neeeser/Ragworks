/**
 * Prompt library API mocks, split out of `mocks.ts` to keep that module
 * under the 400-line ceiling. Spread into `mockApi`'s object — this is not
 * a second mock surface, just the same one in two files.
 */
import { vi } from "vitest";

import { makePromptRead } from "@/test/fixtures";

export function promptApiMocks() {
  return {
    listPrompts: vi.fn(async () => [makePromptRead()]),
    getPrompt: vi.fn(async () => ({
      ...makePromptRead(),
      body: "Body",
      system_body: null,
      used_by: [],
    })),
    createPrompt: vi.fn(async () => makePromptRead()),
    updatePrompt: vi.fn(async () => makePromptRead()),
    deletePrompt: vi.fn(async () => undefined),
    listPromptVersions: vi.fn(async () => []),
    savePromptVersion: vi.fn(async () => ({
      id: "pv-1",
      prompt_id: "prompt-1",
      version: 2,
      body: "Body",
      system_body: null,
      label: null,
      created_at: "2024-01-01T00:00:00Z",
    })),
    forkPrompt: vi.fn(async () => makePromptRead({ id: "prompt-fork" })),
    listPromptCatalogs: vi.fn(async () => []),
    renderPrompt: vi.fn(async () => ({
      rendered: "Rendered",
      rendered_system: null,
      unknown_variables: [],
      values: {},
    })),
    streamPromptTest: vi.fn(async () => ({
      rendered: "Rendered",
      rendered_system: null,
      messages: [
        { role: "system" as const, content: "Rendered" },
        { role: "user" as const, content: "Hello" },
      ],
      response_text: "Hi",
      structured_output: null,
    })),
    testPrompt: vi.fn(async () => ({
      rendered: "Rendered",
      rendered_system: null,
      messages: [
        { role: "system" as const, content: "Rendered" },
        { role: "user" as const, content: "Hello" },
      ],
      response_text: "Hi",
      structured_output: null,
    })),
  };
}
