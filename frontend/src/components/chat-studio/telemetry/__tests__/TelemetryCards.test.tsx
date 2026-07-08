import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { markdownComponents } from "@/components/chat-studio/lib/chat-utils";
import { CollectionToolsCard } from "@/components/chat-studio/telemetry/CollectionToolsCard";
import { CollectionVitalsCard } from "@/components/chat-studio/telemetry/CollectionVitalsCard";
import { StreamingSettingsCard } from "@/components/chat-studio/telemetry/StreamingSettingsCard";
import { SystemPromptCard } from "@/components/chat-studio/telemetry/SystemPromptCard";
import { UsageCard } from "@/components/chat-studio/telemetry/UsageCard";

import type { Collection, UsageBreakdown } from "@/lib/types";

const baseTimestamp = "2024-01-01T00:00:00.000Z";

describe("Telemetry cards", () => {
  it("renders system prompt states", () => {
    const { rerender } = render(
      <SystemPromptCard
        promptPreviewMarkdown=""
        promptSections={[]}
        promptLoading
        promptError={null}
        onEdit={() => undefined}
        markdownComponents={markdownComponents}
      />,
    );

    expect(screen.getByText(/Loading prompt/)).toBeInTheDocument();

    rerender(
      <SystemPromptCard
        promptPreviewMarkdown=""
        promptSections={[]}
        promptLoading={false}
        promptError="Failed"
        onEdit={() => undefined}
        markdownComponents={markdownComponents}
      />,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();

    rerender(
      <SystemPromptCard
        promptPreviewMarkdown="Hello"
        promptSections={[{ id: "base", label: "Base", scope: "base", isCustom: true }]}
        promptLoading={false}
        promptError={null}
        generatedAt="Now"
        onEdit={() => undefined}
        markdownComponents={markdownComponents}
      />,
    );
    expect(screen.getByText("Base prompt · Custom")).toBeInTheDocument();
    expect(screen.getByText("Now")).toBeInTheDocument();

    rerender(
      <SystemPromptCard
        promptPreviewMarkdown="Hello"
        promptSections={[{ id: "tool", label: "Retriever", scope: "collection", isCustom: false }]}
        promptLoading={false}
        promptError={null}
        generatedAt={null}
        onEdit={() => undefined}
        markdownComponents={markdownComponents}
      />,
    );
    expect(screen.getByText("Retriever")).toBeInTheDocument();

    rerender(
      <SystemPromptCard
        promptPreviewMarkdown=" "
        promptSections={[]}
        promptLoading={false}
        promptError={null}
        generatedAt={null}
        onEdit={() => undefined}
        markdownComponents={markdownComponents}
      />,
    );
    expect(screen.getByText("No prompt content yet.")).toBeInTheDocument();
  });

  it("renders collection tool states", () => {
    const collections: Collection[] = [
      {
        id: "col-1",
        user_id: "user-1",
        name: "Docs",
        created_at: baseTimestamp,
        updated_at: baseTimestamp,
      },
    ];

    const onToggle = vi.fn();
    const onClear = vi.fn();

    const { rerender } = render(
      <CollectionToolsCard
        collections={collections}
        selectedCollectionIds={[]}
        onToggle={onToggle}
        onClear={onClear}
        collectionsLoading
        collectionsError={null}
      />,
    );
    expect(screen.getByText(/Loading collections/)).toBeInTheDocument();

    rerender(
      <CollectionToolsCard
        collections={collections}
        selectedCollectionIds={[]}
        onToggle={onToggle}
        onClear={onClear}
        collectionsLoading={false}
        collectionsError="Error"
      />,
    );
    expect(screen.getByText("Error")).toBeInTheDocument();

    rerender(
      <CollectionToolsCard
        collections={collections}
        selectedCollectionIds={["col-1"]}
        onToggle={onToggle}
        onClear={onClear}
        collectionsLoading={false}
        collectionsError={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClear).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Docs" }));
    expect(onToggle).toHaveBeenCalledWith("col-1");

    rerender(
      <CollectionToolsCard
        collections={collections}
        selectedCollectionIds={["col-1", "missing"]}
        onToggle={onToggle}
        onClear={onClear}
        collectionsLoading={false}
        collectionsError={null}
      />,
    );
    expect(screen.getByText("2 collections enabled")).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();

    rerender(
      <CollectionToolsCard
        collections={collections}
        selectedCollectionIds={[]}
        onToggle={onToggle}
        onClear={onClear}
        collectionsLoading={false}
        collectionsError={null}
      />,
    );
    expect(screen.getByText("No collections enabled")).toBeInTheDocument();
    expect(screen.getAllByText("No collections").length).toBeGreaterThan(0);

    rerender(
      <CollectionToolsCard
        collections={[]}
        selectedCollectionIds={[]}
        onToggle={onToggle}
        onClear={onClear}
        collectionsLoading={false}
        collectionsError={null}
      />,
    );
    expect(screen.getByText("No collections available.")).toBeInTheDocument();
  });

  it("renders collection vitals", () => {
    const { rerender } = render(
      <CollectionVitalsCard collection={null} collectionCount={0} documentCount={0} />,
    );
    expect(screen.getByText(/No collection tools selected/)).toBeInTheDocument();

    rerender(<CollectionVitalsCard collection={null} collectionCount={2} documentCount={0} />);
    expect(screen.getByText(/Loading collection details/)).toBeInTheDocument();

    rerender(
      <CollectionVitalsCard
        collection={{
          id: "col-1",
          user_id: "user-1",
          name: "Docs",
          created_at: baseTimestamp,
          updated_at: baseTimestamp,
          ingestion_pipeline_id: null,
          retrieval_pipeline_id: "retrieval-1",
        }}
        collectionCount={2}
        documentCount={10}
      />,
    );
    expect(screen.getByText(/Tools enabled/)).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("retrieval-1")).toBeInTheDocument();

    rerender(
      <CollectionVitalsCard
        collection={{
          id: "col-2",
          user_id: "user-1",
          name: "More",
          created_at: baseTimestamp,
          updated_at: baseTimestamp,
          ingestion_pipeline_id: "ingestion-1",
          retrieval_pipeline_id: null,
        }}
        collectionCount={1}
        documentCount={1}
      />,
    );
    expect(screen.getAllByText("Default").length).toBeGreaterThan(0);
  });

  it("toggles streaming settings", () => {
    const onToggle = vi.fn();
    render(<StreamingSettingsCard streamingEnabled={false} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("renders usage and exports", () => {
    const usage: UsageBreakdown = {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
      reasoning_tokens: 0,
      cost: 0.01,
    };

    const onExport = vi.fn();
    render(
      <UsageCard usage={usage} contextWindow={100} contextConsumed={50} onExport={onExport} />,
    );

    expect(screen.getByText(/50/)).toBeInTheDocument();
    expect(screen.getByText(/OpenRouter total cost/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export chat history" }));
    expect(onExport).toHaveBeenCalled();
  });

  it("renders usage fallbacks without context windows", () => {
    render(<UsageCard usage={null} contextWindow={0} contextConsumed={15} onExport={() => {}} />);

    expect(screen.getByText("15 tokens consumed")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
