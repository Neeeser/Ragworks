# Tidepool Protocol Specification Summary

Tidepool is a fictional distributed-consensus protocol used as sample
content for retrieval testing. The document summarizes its consensus
rounds, membership rules, and failure handling in plain factual prose.

## Consensus rounds

A Tidepool consensus round is triggered by either of two conditions: the
pending-write buffer on any acceptor reaching 4,096 entries, or 250
milliseconds elapsing since the previous round closed, whichever comes
first. Rounds are numbered by a 64-bit monotonic counter owned by the
current coordinator; a counter gap larger than one is treated as evidence
of a partition and forces a membership epoch change.

Each round proceeds in two phases. In the propose phase, the coordinator
broadcasts a batch digest to all acceptors and waits for acknowledgments
from a quorum of ceil(2n/3) nodes. In the seal phase, the coordinator
publishes the quorum certificate, at which point every entry in the batch
is durable. A round that fails to seal within 900 milliseconds is abandoned
and its entries return to the pending buffer with their original arrival
order preserved.

## Membership

Clusters run between 4 and 31 voting acceptors; even cluster sizes are
permitted but reduce fault tolerance to that of the next odd size down.
Joining nodes replay the log from the most recent snapshot, then shadow two
full epochs as non-voting observers before the coordinator proposes their
promotion. Removal is immediate on three consecutive missed seal
acknowledgments, a rule that also serves as the protocol's failure
detector.

## Snapshots and log compaction

Snapshots are taken every 50,000 sealed rounds or 512 megabytes of log,
whichever comes first. A snapshot is valid only when signed by a quorum of
the epoch in which it was taken; unsigned snapshots may be used for reads
but never for recovery. After a snapshot is quorum-signed, log segments
older than the previous snapshot are eligible for deletion, giving a
worst-case retained window of two snapshot intervals.

## Client guarantees

Tidepool offers linearizable writes and two read modes. Sealed reads
consult the latest quorum certificate and are linearizable; local reads are
served from any acceptor's applied state and may lag by at most one
unsealed round, a bound enforced by acceptors refusing local reads while
more than one round is in flight. Client sessions carry a 128-bit
idempotency token, and duplicate submissions within a retained window are
acknowledged without re-execution.
