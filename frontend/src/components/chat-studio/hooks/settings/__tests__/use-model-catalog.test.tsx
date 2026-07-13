import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useModelCatalog } from "@/components/chat-studio/hooks/settings/use-model-catalog";
import { listChatModels } from "@/lib/api";
import { makeCatalogModel, makeModelCatalog } from "@/test/fixtures/providers";

vi.mock("@/lib/api", async () => {
  const { mockApi } = await import("@/test/mocks");
  return mockApi();
});

const OLLAMA_CONNECTION = "conn-ollama-1";
const OLLAMA_MODEL = "llama3.2:1b";

const catalog = makeModelCatalog([
  makeCatalogModel({ id: "openai/gpt-4o", name: "GPT-4o" }),
  makeCatalogModel({
    id: OLLAMA_MODEL,
    name: OLLAMA_MODEL,
    connection_id: OLLAMA_CONNECTION,
    connection_label: "Homelab Ollama",
    provider_type: "ollama",
  }),
]);

function renderCatalog() {
  return renderHook(() =>
    useModelCatalog({
      authToken: "token",
      authLoading: false,
      chatProviderConfigured: true,
      activeModelId: null,
      activeConnectionId: null,
      toolsEnabled: false,
    }),
  );
}

describe("useModelCatalog connection filter", () => {
  it("scopes the visible models to the selected connection and lists one option per connection", async () => {
    vi.mocked(listChatModels).mockResolvedValue(catalog);
    const { result } = renderCatalog();
    await waitFor(() => expect(result.current.modelCatalog).toHaveLength(2));

    expect(result.current.connectionOptions).toEqual([
      { connectionId: "conn-openrouter-1", label: "OpenRouter", providerType: "openrouter" },
      { connectionId: OLLAMA_CONNECTION, label: "Homelab Ollama", providerType: "ollama" },
    ]);

    act(() => result.current.setConnectionFilter(OLLAMA_CONNECTION));
    await waitFor(() =>
      expect(result.current.sortedModelCatalog.map((model) => model.id)).toEqual([OLLAMA_MODEL]),
    );

    act(() => result.current.setConnectionFilter(""));
    await waitFor(() => expect(result.current.sortedModelCatalog).toHaveLength(2));
  });
});
