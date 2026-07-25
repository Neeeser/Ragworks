import { Chip } from "@/components/ui/chip";
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

/**
 * Column widths shared by each list's header, rows and loading placeholder, so
 * the numbers line up in a column and data landing causes no reflow.
 */
/** Wide enough for a thousands-separated count or a "Jul 24" fallback date. */
const NUMERIC_COL = "w-16 text-right";

const DOC_COL = {
  collection: "w-28",
  status: "w-28",
  chunks: NUMERIC_COL,
  added: NUMERIC_COL,
};

const CHAT_COL = {
  model: "w-40",
  updated: NUMERIC_COL,
};

/**
 * A document's ingestion state, in the backend's own vocabulary.
 *
 * The word is rendered beside the dot rather than instead of it, so the state is
 * readable without colour discrimination.
 */
const STATUS_TONE: Record<DocumentStatus, StatusTone> = {
  ready: "pos",
  failed: "neg",
  processing: "warn",
  pending: "neutral",
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
    // A named region per list: three peer lists share this page, and a landmark
    // each is how a screen reader user moves between them without reading rows.
    <section aria-label="Recent ingestion" className="bg-canvas-raised">
      <DataRowHeader
        title="Recent ingestion"
        columns={[
          <InstrumentLabel key="collection" className={DOC_COL.collection}>
            Collection
          </InstrumentLabel>,
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
          columnWidths={[DOC_COL.collection, DOC_COL.status, DOC_COL.chunks, DOC_COL.added]}
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
              columns={[
                <Tooltip
                  key="collection"
                  content={collectionName}
                  triggerClassName={DOC_COL.collection}
                >
                  <span className="truncate text-ui text-meta">{collectionName}</span>
                </Tooltip>,
                <StatusDot
                  key="status"
                  tone={STATUS_TONE[doc.status]}
                  label={doc.status.toUpperCase()}
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
    <section aria-label="Recent chats" className="bg-canvas-raised">
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
              // Model ids are long and routinely truncated in a column, so the
              // full id stays available on hover rather than being lost.
              <Tooltip key="model" content={session.chat_model} triggerClassName={CHAT_COL.model}>
                <Chip tone="chat">{session.chat_model}</Chip>
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
 * They share a seam rather than sitting in two gapped cards, so they read as one
 * instrument with two regions. Both were previously card grids whose rows each
 * carried their own 16px border and rounded fill; the columns here hold the same
 * facts on one line each.
 */
export function DashboardActivity({
  recentDocuments,
  recentSessions,
  collectionNameById,
  loading = false,
}: DashboardActivityProps) {
  return (
    <PanelGrid columns={2}>
      <IngestionList
        documents={recentDocuments}
        collectionNameById={collectionNameById}
        loading={loading}
      />
      <ChatList sessions={recentSessions} loading={loading} />
    </PanelGrid>
  );
}
