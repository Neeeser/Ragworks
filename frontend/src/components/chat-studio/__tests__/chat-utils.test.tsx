import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

import {
  coerceRecord,
  markdownComponents,
  normalizeReasoningSegments,
  parsePriceInput,
  safeParseJSON,
  sanitizeFileName,
  sanitizeModelSlug,
} from "@/components/chat-studio/chat-utils";

describe("chat-utils", () => {
  it("parses JSON safely", () => {
    expect(safeParseJSON()).toBeNull();
    expect(safeParseJSON("{invalid")).toBeNull();
    expect(safeParseJSON('{"ok":true}')).toEqual({ ok: true });
  });

  it("sanitizes model slugs and filenames", () => {
    expect(sanitizeModelSlug("openai/gpt-4:free")).toBe("openai/gpt-4");
    expect(sanitizeModelSlug("gpt-4")).toBeNull();
    expect(sanitizeModelSlug(":")).toBeNull();
    expect(sanitizeFileName(" My File.pdf ")).toBe("My-File-pdf");
    expect(sanitizeFileName(null)).toBe("");
  });

  it("parses price inputs and coerces records", () => {
    expect(parsePriceInput(" 1.5 ")).toBe(1.5);
    expect(parsePriceInput("   ")).toBeNull();
    expect(parsePriceInput("abc")).toBeNull();
    expect(parsePriceInput("")).toBeNull();

    expect(coerceRecord({ key: "value" })).toEqual({ key: "value" });
    expect(coerceRecord([1, 2])).toEqual({ items: [1, 2] });
    expect(coerceRecord(null)).toEqual({});
    expect(coerceRecord(3)).toEqual({ value: 3 });
  });

  it("normalizes reasoning segments", () => {
    expect(normalizeReasoningSegments(" ")).toEqual([]);
    const stringSegments = normalizeReasoningSegments("Hello");
    expect(stringSegments[0]).toEqual(
      expect.objectContaining({ type: "text", content: "Hello", text: "Hello" }),
    );

    const merged = normalizeReasoningSegments([
      { type: "text", content: "Hello" },
      { type: "text", content: "world" },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe("Helloworld");

    const separated = normalizeReasoningSegments([
      { type: "text", content: "A", call_id: "1" },
      { type: "text", content: "B", call_id: "2" },
    ]);
    expect(separated).toHaveLength(2);

    const nested = normalizeReasoningSegments({ segments: [{ type: "text", content: "Hi" }] });
    expect(nested).toHaveLength(1);

    const numeric = normalizeReasoningSegments(5);
    expect(numeric[0]).toEqual(expect.objectContaining({ type: "value", content: "5" }));

    const mixed = normalizeReasoningSegments([null, { content: "Alpha" } as ReasoningTraceSegment]);
    expect(mixed[0]).toEqual(expect.objectContaining({ type: "text", content: "Alpha" }));

    const fromTextField = normalizeReasoningSegments([
      { type: "text", text: "Inline text", content: 123 } as ReasoningTraceSegment,
    ]);
    expect(fromTextField[0]).toEqual(
      expect.objectContaining({ text: "Inline text", content: "Inline text" }),
    );

    const fromContentField = normalizeReasoningSegments([
      { type: "text", text: 5, content: "Content text" } as ReasoningTraceSegment,
    ]);
    expect(fromContentField[0]).toEqual(
      expect.objectContaining({ text: "Content text", content: "Content text" }),
    );

    const usesPrevContentWhenTextMissing = normalizeReasoningSegments([
      { type: "text", text: 0, content: "" } as ReasoningTraceSegment,
      { type: "text", content: "Merged" } as ReasoningTraceSegment,
    ]);
    expect(usesPrevContentWhenTextMissing).toHaveLength(1);
    expect(usesPrevContentWhenTextMissing[0].text).toBe("Merged");

    const doesNotMergeAcrossTypes = normalizeReasoningSegments([
      { type: "tool", content: "First" } as ReasoningTraceSegment,
      { type: "text", content: "Second" } as ReasoningTraceSegment,
    ]);
    expect(doesNotMergeAcrossTypes).toHaveLength(2);

    const usesFallbackTextValue = normalizeReasoningSegments([
      { type: "text", content: 123 } as ReasoningTraceSegment,
      { type: "text", content: "Next" } as ReasoningTraceSegment,
    ]);
    expect(usesFallbackTextValue).toHaveLength(1);
    expect(usesFallbackTextValue[0]).toEqual(
      expect.objectContaining({ text: "Next", content: "Next" }),
    );

    const nonMergeableEntryType = normalizeReasoningSegments([
      { type: "text", content: "Alpha" } as ReasoningTraceSegment,
      { type: "tool", content: "Beta" } as ReasoningTraceSegment,
    ]);
    expect(nonMergeableEntryType).toHaveLength(2);

    const mergesWithMissingPrevType = normalizeReasoningSegments([
      { content: "First" } as ReasoningTraceSegment,
      { type: "text", content: "Second" } as ReasoningTraceSegment,
    ]);
    expect(mergesWithMissingPrevType).toHaveLength(1);
    expect(mergesWithMissingPrevType[0].text).toBe("FirstSecond");

    const mergesWithNoPrevText = normalizeReasoningSegments([
      { type: "text", text: 5, content: 10 } as ReasoningTraceSegment,
      { type: "text", content: "Next" } as ReasoningTraceSegment,
    ]);
    expect(mergesWithNoPrevText).toHaveLength(1);
    expect(mergesWithNoPrevText[0].text).toBe("Next");

    const mergesWithNonStringPrevious = normalizeReasoningSegments([
      { type: "text", content: 123 } as ReasoningTraceSegment,
      { type: "text", content: "Next" } as ReasoningTraceSegment,
    ]);
    expect(mergesWithNonStringPrevious).toHaveLength(1);
    expect(mergesWithNonStringPrevious[0].text).toBe("Next");

    const mergesWithSameContext = normalizeReasoningSegments([
      { type: "reasoning.text", text: "Hello", call_id: "ctx-1" } as ReasoningTraceSegment,
      { type: "text", content: "there", call_id: "ctx-1" } as ReasoningTraceSegment,
    ]);
    expect(mergesWithSameContext).toHaveLength(1);
    expect(mergesWithSameContext[0].text).toContain("Hello");

    const mergesWithEmptyType = normalizeReasoningSegments([
      { content: "Alpha" } as ReasoningTraceSegment,
      { type: "", content: "Beta" } as ReasoningTraceSegment,
    ]);
    expect(mergesWithEmptyType).toHaveLength(1);
    expect(mergesWithEmptyType[0].text).toBe("AlphaBeta");

    const mergesWithNonStringPrevContent = normalizeReasoningSegments([
      { type: "text", content: 123 } as ReasoningTraceSegment,
      { type: "text", content: "Next" } as ReasoningTraceSegment,
    ]);
    expect(mergesWithNonStringPrevContent).toHaveLength(1);
    expect(mergesWithNonStringPrevContent[0].text).toBe("Next");

    const mergesWithContentFallback = normalizeReasoningSegments([
      { type: "text", content: "Alpha", call_id: "ctx-2" } as ReasoningTraceSegment,
      { type: "text", content: "Beta", call_id: "ctx-2" } as ReasoningTraceSegment,
    ]);
    expect(mergesWithContentFallback).toHaveLength(1);
    expect(mergesWithContentFallback[0].text).toBe("AlphaBeta");

    const mergesWithNonStringPrevInContext = normalizeReasoningSegments([
      { type: "text", content: 123, call_id: "ctx-3" } as ReasoningTraceSegment,
      { type: "text", content: "Next", call_id: "ctx-3" } as ReasoningTraceSegment,
    ]);
    expect(mergesWithNonStringPrevInContext).toHaveLength(1);
    expect(mergesWithNonStringPrevInContext[0].text).toBe("Next");
  });

  it("renders markdown components", () => {
    const InlineCode = markdownComponents.code as React.FC<{
      inline?: boolean;
      className?: string;
      children: React.ReactNode;
    }>;
    const Link = markdownComponents.a as React.FC<{ href?: string; children: React.ReactNode }>;
    const Pre = markdownComponents.pre as React.FC<{ children: React.ReactNode }>;
    const Blockquote = markdownComponents.blockquote as React.FC<{ children: React.ReactNode }>;
    const Strong = markdownComponents.strong as React.FC<{ children: React.ReactNode }>;
    const Paragraph = markdownComponents.p as React.FC<{ children: React.ReactNode }>;
    const ListItem = markdownComponents.li as React.FC<{ children: React.ReactNode }>;
    const UnorderedList = markdownComponents.ul as React.FC<{ children: React.ReactNode }>;
    const OrderedList = markdownComponents.ol as React.FC<{ children: React.ReactNode }>;

    render(
      <div>
        <InlineCode inline className="inline-code">
          inline
        </InlineCode>
        <InlineCode inline={false} className="block-code">
          block
        </InlineCode>
        <Link href="https://example.com">Link</Link>
        <Pre>preformatted</Pre>
        <Blockquote>Quote</Blockquote>
        <Strong>Strong</Strong>
        <Paragraph>Paragraph</Paragraph>
        <UnorderedList>
          <ListItem>Item</ListItem>
        </UnorderedList>
        <OrderedList>
          <ListItem>Item 2</ListItem>
        </OrderedList>
      </div>,
    );

    expect(screen.getByText("inline")).toHaveClass("inline-code");
    expect(screen.getByText("block")).toHaveClass("block-code");
    expect(screen.getByText("Link")).toHaveAttribute("href", "https://example.com");
    expect(screen.getByText("preformatted")).toBeInTheDocument();
    expect(screen.getByText("Quote")).toBeInTheDocument();
    expect(screen.getByText("Strong")).toBeInTheDocument();
    expect(screen.getByText("Paragraph")).toBeInTheDocument();
    expect(screen.getByText("Item")).toBeInTheDocument();
    expect(screen.getByText("Item 2")).toBeInTheDocument();
  });
});
