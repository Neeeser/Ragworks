"""Port types and connection compatibility rules for pipeline nodes."""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel


class PortType(StrEnum):
    """Data types that flow between pipeline node input/output ports.

    Node port declarations (see `app/pipelines/nodes/`) still use the raw string
    values today; this enum exists as the single catalog of valid values so a
    future pass can switch node declarations to reference it directly.
    """

    DOCUMENT_SOURCE = "document_source"
    DOCUMENT = "document"
    CHUNK_BATCH = "chunk_batch"
    EMBEDDED_BATCH = "embedded_batch"
    INDEXED_BATCH = "indexed_batch"
    QUERY_REQUEST = "query_request"
    QUERY_EMBEDDING = "query_embedding"
    RETRIEVAL_RESULTS = "retrieval_results"


class NodePort(BaseModel):
    """Port metadata describing node input/output connectivity.

    An input port with `accepts_many=True` is variadic: any number of edges
    may target it, the executor collects every inbound value into a list
    (always a list, even for a single edge), and the node runs only once all
    wired edges have delivered. Fusion-style nodes (take many result streams,
    emit one) declare their input this way. Output ports never set it.
    """

    key: str
    label: str
    data_type: str
    required: bool = True
    accepts_many: bool = False


def compatible(source_type: str, target_type: str) -> bool:
    """Return True when a source port's data type may connect to a target port's.

    Port compatibility is an identity relation today: a port only connects to
    another port carrying the exact same data type. This function (rather than
    an inline `==` at each call site) exists so a future non-identity rule --
    e.g. a port accepting several related types -- has one place to land.
    """
    return source_type == target_type
