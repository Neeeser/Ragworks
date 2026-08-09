import { DataRow, DataRowHeader, DataRowSkeleton } from "@/components/ui/data-row";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { PanelGrid } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { Tooltip } from "@/components/ui/tooltip";
import { parseApiDate } from "@/lib/datetime";
import { formatTimeAgoCompact } from "@/lib/format";

import type { StatusTone } from "@/components/ui/status-dot";
import type { ChatSession, Document, DocumentStatus } from "@/lib/types";

type DashboardActivityProps = {
  recentDocuments: Document[];
  recentSessions: ChatSession[];
  /** Names the collection each document row belongs to. */
  collectionNameById: Map<string, string>;
  loading?: boolean;
};

/*
 * Column widths below are shared by each list's header, its rows and its loading
 * placeholder — one constant per column, so the numbers line up and data landing
 * causes no reflow.
 *
 * Below `sm` the columns wrap onto their own line under the name, so every width
 * has a narrower phone value: at the desktop widths the three of them overflow a
 * 375px pane and the last column wraps again onto a line of its own.
 */

/** Wide enough for a thousands-separated count or a "Jul 24" fallback date. */
const NUMERIC_COL = "w-14 text-right sm:w-16";

const DOC_COL = {
  /** Fits the longest status word, Processing, beside its dot. */
  status: "w-24 sm:w-28",
  chunks: NUMERIC_COL,
  added: NUMERIC_COL,
};

const CHAT_COL = {
  /** Fits a lowercase provider/model id of ~34 characters; longer show on hover. */
  model: "w-40 sm:w-56",
  updated: NUMERIC_COL,
};

/**
 * A document's ingestion state: the backend's enum word humanised to sentence
 * case, rendered beside the dot rather than instead of it, so the state is
 * readable without colour discrimination.
 *
 * Tones match the Files page's derivation: in-flight work (`pending`,
 * `processing`) is `active`, not `warn` — a document being ingested is not a
 * document that needs attention.
 */
const STATUS: Record<DocumentStatus, { tone: StatusTone; label: string }> = {
  ready: { tone: "pos", label: "Ready" },
  failed: { tone: "neg", label: "Failed" },
  processing: { tone: "active", label: "Processing" },
  pending: { tone: "active", label: "Pending" },
  unsupported: { tone: "neutral", label: "Unsupported" },
};

function IngestionList({
  documents,
  collectionNameById,
  loading,
}: {
  documents: Document[];
  collectionNameById: Map<string, string>;
  loading: boolean;
}) {
  return (
    // A named region per list: this page carries three peer regions, and a
    // landmark each is how a screen reader user moves between them without
    // reading every row. Raw `card-surface` rather than `Panel` because the
    // landmark needs a <section>, which the div-rendering primitive can't be.
    <section aria-label="Recent ingestion" className="card-surface">
      <DataRowHeader
        title="Recent ingestion"
        columns={[
          <InstrumentLabel key="status" className={DOC_COL.status}>
            Status
          </InstrumentLabel>,
          <InstrumentLabel key="chunks" className={DOC_COL.chunks}>
            Chunks
          </InstrumentLabel>,
          <InstrumentLabel key="added" className={DOC_COL.added}>
            Added
          </InstrumentLabel>,
        ]}
      />
      {loading ? (
        <DataRowSkeleton
          label="Loading recent ingestion"
          hasSubtitle
          columnWidths={[DOC_COL.status, DOC_COL.chunks, DOC_COL.added]}
        />
      ) : documents.length === 0 ? (
        <p className="p-3 text-ui text-muted">No documents ingested yet.</p>
      ) : (
        documents.map((doc) => {
          const collectionName = collectionNameById.get(doc.collection_id) ?? doc.collection_id;
          return (
            <DataRow
              key={doc.id}
              href={`/collections/${doc.collection_id}/files`}
              title={doc.name}
              /* The list spans every collection, so a bare filename doesn't say
                 where the document lives. The owning collection is a second line
                 rather than a column because a name truncated into ~110px reads
                 as noise beside the status it was crowding. */
              subtitle={collectionName}
              columns={[
                <StatusDot
                  key="status"
                  tone={STATUS[doc.status].tone}
                  label={STATUS[doc.status].label}
                  className={DOC_COL.status}
                />,
                <span key="chunks" className={`font-mono tabular-nums ${DOC_COL.chunks}`}>
                  {doc.num_chunks.toLocaleString()}
                </span>,
                <Tooltip
                  key="added"
                  content={parseApiDate(doc.created_at)?.toLocaleString() ?? ""}
                  triggerClassName={`justify-end ${DOC_COL.added}`}
                >
                  <span className="font-mono tabular-nums text-meta">
                    {formatTimeAgoCompact(doc.created_at)}
                  </span>
                </Tooltip>,
              ]}
            />
          );
        })
      )}
    </section>
  );
}

function ChatList({ sessions, loading }: { sessions: ChatSession[]; loading: boolean }) {
  return (
    <section aria-label="Recent chats" className="card-surface">
      <DataRowHeader
        title="Recent chats"
        columns={[
          <InstrumentLabel key="model" className={CHAT_COL.model}>
            Model
          </InstrumentLabel>,
          <InstrumentLabel key="updated" className={CHAT_COL.updated}>
            Updated
          </InstrumentLabel>,
        ]}
      />
      {loading ? (
        <DataRowSkeleton
          label="Loading recent chats"
          columnWidths={[CHAT_COL.model, CHAT_COL.updated]}
        />
      ) : sessions.length === 0 ? (
        <p className="p-3 text-ui text-muted">No chat sessions yet.</p>
      ) : (
        sessions.map((session) => (
          <DataRow
            key={session.id}
            href={`/chat/${session.id}`}
            title={session.title || "Untitled session"}
            columns={[
              // Verbatim, not a Chip: a model id is a case-sensitive identifier
              // (`anthropic/claude-3.5-haiku`) — a literal, so it renders in
              // mono outside any label voice. A chip here would also carry a
              // `chat`-toned dot that means nothing: every row in this list is
              // a chat.
              <Tooltip key="model" content={session.chat_model} triggerClassName={CHAT_COL.model}>
                <span className="truncate font-mono text-instrument text-muted">
                  {session.chat_model}
                </span>
              </Tooltip>,
              <Tooltip
                key="updated"
                content={parseApiDate(session.updated_at)?.toLocaleString() ?? ""}
                triggerClassName={`justify-end ${CHAT_COL.updated}`}
              >
                <span className="font-mono tabular-nums text-meta">
                  {formatTimeAgoCompact(session.updated_at)}
                </span>
              </Tooltip>,
            ]}
          />
        ))
      )}
    </section>
  );
}

/**
 * The two activity lists a user returns to work through: what was ingested, and
 * what was asked.
 *
 * Two adjacent cards separated by the standard `gap-3` — cards are objects; the
 * seam language lives inside each card as hairline-separated rows. Every fact a
 * row holds is a column, and no row reserves space for a value it doesn't have.
 */
export function DashboardActivity({
  recentDocuments,
  recentSessions,
  collectionNameById,
  loading = false,
}: DashboardActivityProps) {
  return (
    // `flex-1` so the two cards run to the bottom of the viewport. Sized to
    // their rows instead, they floated over ~450px of bare canvas — which reads
    // as the page having failed to load something rather than as two panes with
    // little in them.
    <PanelGrid columns={2} className="min-h-0 flex-1">
      <IngestionList
        documents={recentDocuments}
        collectionNameById={collectionNameById}
        loading={loading}
      />
      <ChatList sessions={recentSessions} loading={loading} />
    </PanelGrid>
  );
}
