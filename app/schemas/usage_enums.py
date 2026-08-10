"""Enums describing what the usage ledger recorded and how it is read back.

Split from `app/schemas/enums.py` by module size and re-exported there, so
every importer still reaches them through the one domain-enum namespace.
"""

from __future__ import annotations

from enum import Enum


class UsageKind(str, Enum):
    """What a recorded provider call spent tokens (or units) on.

    Vector-store reads and writes are members from the start so the ledger's
    `kind` column never has to be rewritten to admit them.
    """

    CHAT = "chat"
    EMBEDDING = "embedding"
    RERANK = "rerank"
    VECTOR_STORE_READ = "vector_store_read"
    VECTOR_STORE_WRITE = "vector_store_write"


class UsageSurface(str, Enum):
    """Which part of the app made the call the ledger recorded.

    The surface comes from the scope the call site opened, never from the
    provider boundary — the same embedder serves ingestion and a chat turn.
    """

    CHAT = "chat"
    STUDIO = "studio"
    INGESTION = "ingestion"
    EVAL_GENERATION = "eval_generation"
    EVAL_RUN = "eval_run"
    CONNECTION_TEST = "connection_test"


class UsageUnit(str, Enum):
    """What a usage event's `quantity` counts.

    Cohere bills reranking in search units rather than tokens, so a unit
    column is what keeps its quantity from being read as a token count.
    Pinecone bills data-plane reads in read units and reports them per
    request, so those are stored in the unit Pinecone stated too.
    """

    TOKENS = "tokens"
    SEARCH_UNITS = "search_units"
    READ_UNITS = "read_units"


class UsageGroupBy(str, Enum):
    """Which dimension a usage summary's group rows are cut by.

    `USER` is admin-only: the per-user endpoint already scopes to one caller,
    so offering it there would produce a single row naming the caller.
    """

    MODEL = "model"
    KIND = "kind"
    SURFACE = "surface"
    CONNECTION = "connection"
    USER = "user"


class UsageBucket(str, Enum):
    """The time granularity a usage series is bucketed at."""

    DAY = "day"
    HOUR = "hour"
