import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "@/app/(console)/dashboard/page";
import * as apiModule from "@/lib/api";
import { makeChatSession, makeCollection, makeConnection, makeDocument } from "@/test/fixtures";
import { resetMockAuth, setMockAuth } from "@/test/mocks";

import type { Collection } from "@/lib/types";

vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());
vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

const LOAD_FAILED = "Load failed";
const CHUNKS_KPI = "Chunks indexed";
const FIRST_DOC = "onboarding.md";
const COL_TWO = "col-2";
const FAILED_REGION = "Failed ingestion";

/** A KPI cell's whole text, so the label and its value are asserted together. */
const kpi = (label: string) => screen.getByText(label).parentElement?.textContent ?? "";

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe("DashboardPage", () => {
  const collections: Collection[] = [
    makeCollection({ id: "col-1", name: "Handbook", description: null }),
    makeCollection({ id: COL_TWO, name: "Contracts", description: null }),
  ];

  beforeEach(() => {
    resetMockAuth();
    api.fetchCollections.mockResolvedValue(collections);
    api.listConnections.mockResolvedValue([makeConnection()]);
    api.fetchDocuments.mockImplementation(async (_token: string, collectionId: string) =>
      collectionId === "col-1"
        ? [makeDocument({ id: "doc-1", name: FIRST_DOC, num_chunks: 7 })]
        : [makeDocument({ id: "doc-2", collection_id: COL_TWO, name: "msa.pdf", num_chunks: 3 })],
    );
    api.listChatSessions.mockResolvedValue([
      makeChatSession({ id: "session-1", title: "Retrieval spike", chat_model: "gpt-4o-mini" }),
    ]);
  });

  it("aggregates the workspace into the KPI strip", async () => {
    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText(CHUNKS_KPI)).toBeInTheDocument());
    expect(kpi("Collections")).toContain("2");
    expect(kpi("Documents")).toContain("2");
    expect(kpi(CHUNKS_KPI)).toContain("10");
    expect(kpi("Chat sessions")).toContain("1");
  });

  it("shows skeleton rows at the list's geometry, not loaded rows, while fetching", () => {
    setMockAuth({ token: null, user: null });
    render(<DashboardPage />);

    expect(screen.getByText("Loading recent ingestion")).toBeInTheDocument();
    expect(screen.getByText("Loading recent chats")).toBeInTheDocument();
    expect(screen.queryByText(FIRST_DOC)).not.toBeInTheDocument();
  });

  it("names each recent document's collection, status, chunk count and age", async () => {
    render(<DashboardPage />);

    const list = await waitFor(() => screen.getByRole("region", { name: "Recent ingestion" }));
    const row = within(list).getByText(FIRST_DOC).closest("a");
    expect(row).toHaveAttribute("href", "/collections/col-1/files");
    expect(row).toHaveTextContent("Handbook");
    expect(row).toHaveTextContent("READY");
    expect(row).toHaveTextContent("7");
  });

  it("links each recent chat to its session and names the model that answered", async () => {
    render(<DashboardPage />);

    const list = await waitFor(() => screen.getByRole("region", { name: "Recent chats" }));
    const row = within(list).getByText("Retrieval spike").closest("a");
    expect(row).toHaveAttribute("href", "/chat/session-1");
    expect(row).toHaveTextContent("gpt-4o-mini");
  });

  it("calls out failed ingestion per collection and links to the offending files", async () => {
    api.fetchDocuments.mockImplementation(async (_token: string, collectionId: string) =>
      collectionId === COL_TWO
        ? [
            makeDocument({ id: "doc-2", collection_id: COL_TWO, status: "failed", num_chunks: 0 }),
            makeDocument({ id: "doc-3", collection_id: COL_TWO, status: "failed", num_chunks: 0 }),
          ]
        : [],
    );
    render(<DashboardPage />);

    const callout = await waitFor(() => screen.getByRole("region", { name: FAILED_REGION }));
    const row = within(callout).getByText("Contracts").closest("a");
    expect(row).toHaveAttribute("href", "/collections/col-2/files");
    expect(row).toHaveTextContent("2 documents did not ingest in Contracts");
  });

  it("counts a single failure in the singular", async () => {
    api.fetchDocuments.mockImplementation(async (_token: string, collectionId: string) =>
      collectionId === COL_TWO
        ? [makeDocument({ id: "doc-2", collection_id: COL_TWO, status: "failed", num_chunks: 0 })]
        : [],
    );
    render(<DashboardPage />);

    const callout = await waitFor(() => screen.getByRole("region", { name: FAILED_REGION }));
    expect(callout).toHaveTextContent("1 document did not ingest in Contracts");
  });

  it("omits the failure callout entirely when nothing failed", async () => {
    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText(CHUNKS_KPI)).toBeInTheDocument());
    expect(screen.queryByRole("region", { name: FAILED_REGION })).not.toBeInTheDocument();
  });

  it("reports invalid provider configs as workspace state in the breadcrumb", async () => {
    api.listConnections.mockResolvedValueOnce([
      makeConnection({ id: "conn-1" }),
      makeConnection({ id: "conn-2", config_valid: false }),
    ]);
    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText("1 of 2 invalid")).toBeInTheDocument());
  });

  it("reports a workspace with no provider connections", async () => {
    api.listConnections.mockResolvedValueOnce([]);
    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText("No connections")).toBeInTheDocument());
  });

  it("renders no breadcrumb state when the connection list is unavailable", async () => {
    api.listConnections.mockRejectedValueOnce(new Error("Connections down"));
    render(<DashboardPage />);

    // The page still loads: an unreachable connection list is not the overview's
    // content, so it must degrade to no state rather than a misleading zero.
    await waitFor(() => expect(screen.getByText(CHUNKS_KPI)).toBeInTheDocument());
    expect(screen.queryByText("No connections")).not.toBeInTheDocument();
    expect(screen.queryByText(/connections?$/)).not.toBeInTheDocument();
  });

  it("survives a document fetch error and still counts the collections that loaded", async () => {
    api.fetchDocuments.mockImplementation(async (_token: string, collectionId: string) => {
      if (collectionId === "col-1") throw new Error("Doc fail");
      return [makeDocument({ id: "doc-2", collection_id: COL_TWO, num_chunks: 3 })];
    });
    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText(CHUNKS_KPI)).toBeInTheDocument());
    expect(kpi("Collections")).toContain("2");
    expect(kpi(CHUNKS_KPI)).toContain("3");
  });

  it("survives a chat-session fetch error and shows the recent-chats empty state", async () => {
    api.listChatSessions.mockRejectedValueOnce(new Error("Session fail"));
    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText("No chat sessions yet.")).toBeInTheDocument());
    // The ingestion list is unaffected — the sources degrade independently.
    expect(screen.getByText(FIRST_DOC)).toBeInTheDocument();
  });

  it("offers one line and one action for an empty workspace", async () => {
    api.fetchCollections.mockResolvedValueOnce([]);
    api.listChatSessions.mockResolvedValueOnce([]);
    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText("No collections yet.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Create collection" })).toBeInTheDocument();
    // No aggregates and no empty lists beside a workspace that has nothing.
    expect(screen.queryByText(CHUNKS_KPI)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recent ingestion" })).not.toBeInTheDocument();
  });

  it("replaces the aggregates with the error when the collection list fails", async () => {
    api.fetchCollections.mockRejectedValueOnce(new Error(LOAD_FAILED));
    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText(LOAD_FAILED)).toBeInTheDocument());
    // Zeroes after a failed load would read as a real, empty workspace.
    expect(screen.queryByText(CHUNKS_KPI)).not.toBeInTheDocument();
  });

  it("shows the request id beside the error so a user can quote it", async () => {
    const failure = Object.assign(new Error(LOAD_FAILED), { requestId: "req-42" });
    api.fetchCollections.mockRejectedValueOnce(failure);
    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText(LOAD_FAILED)).toBeInTheDocument());
    expect(screen.getByText("Request req-42")).toBeInTheDocument();
  });

  it("falls back to a generic message when the failure carries no message", async () => {
    api.fetchCollections.mockRejectedValueOnce("Load failed");
    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText("Unable to load data.")).toBeInTheDocument());
  });

  it("keeps the loaded values on screen while a token rotation refetches", async () => {
    const { rerender } = render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText(FIRST_DOC)).toBeInTheDocument());

    // The auth provider rotates the token every 12 minutes, re-running every
    // data effect. The values the page already holds are still correct, so the
    // refetch must not replace them with placeholders.
    const pending = createDeferred<Collection[]>();
    api.fetchCollections.mockReturnValueOnce(pending.promise);
    setMockAuth({ token: "rotated-token" });
    rerender(<DashboardPage />);

    expect(screen.queryByText("Loading recent ingestion")).not.toBeInTheDocument();
    expect(screen.getByText(FIRST_DOC)).toBeInTheDocument();
    expect(kpi(CHUNKS_KPI)).toContain("10");

    await act(async () => {
      pending.resolve(collections);
      await pending.promise;
    });
  });
});
