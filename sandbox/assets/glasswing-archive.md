# Glasswing Archive Field Guide

The Glasswing Archive is a fictional digital-preservation system used as
sample content for retrieval testing. The document covers its record
model, deduplication, and audit trail in plain factual prose.

## Record model

Every item in the Glasswing Archive is a record: an immutable payload blob
plus a mutable descriptive envelope. Payloads are stored once, addressed by
a BLAKE3 content hash, and never rewritten; envelopes carry title, agent,
rights, and provenance fields and are versioned with full history. A
record's public identifier is a ULID assigned at first accession, so
identifiers sort by accession time without leaking payload hashes.

## Deduplication

Deduplication happens at accession, in two stages. First, the payload's
BLAKE3 hash is looked up in the content index; an exact match links the new
envelope to the existing payload and no bytes are written. Second, for
image and audio payloads, a perceptual fingerprint (pHash for images,
chromaprint for audio) is compared against the fingerprint index; matches
above the similarity threshold of 0.92 are not merged automatically but are
queued for curator review with both records displayed side by side. Curator
decisions — merge, keep separate, or supersede — are recorded in the audit
trail and are reversible for 30 days.

Text payloads are never perceptually deduplicated: two editions of the same
work are distinct records by policy, linked instead through the envelope's
"edition-of" relation.

## Storage tiers

Payloads move through three tiers. Fresh accessions live on replicated SSD
for 90 days, then migrate to erasure-coded object storage with a 12-of-16
scheme spread across four sites. Records unread for five years migrate to
offline tape, retaining a 64-kilobyte preview stub online. Tier moves are
transparent to identifiers; only retrieval latency changes, from
milliseconds to a documented worst case of four hours for tape recall.

## Audit trail

Every mutation of an envelope, every tier move, and every curator decision
appends an event to the record's audit trail. Events are hash-chained per
record and anchored weekly into a public transparency log, so a record's
history can be verified independently of the archive's own database. The
audit trail is append-only by construction: corrections are new events that
reference the event they amend, never edits.

## Access and rights

Access levels are open, restricted, and dark. Dark records return metadata
only, and even their previews are withheld; restricted records require a
rights assertion that is itself logged in the audit trail. Bulk export is
rate-limited to 10,000 records per requester per day, with hash manifests
provided so exporters can verify completeness.
