"""The auto-ingest content-type catalog: single source of truth.

`uploads.allowed_content_types` (`app/schemas/app_config.py`) must offer and
accept only MIME types the shipped parsers actually handle
(`app/retrieval/parsers/`) — otherwise an admin can enable auto-ingestion for
a type nothing can parse. Both the config default and the admin catalog's
selectable options are built from `KNOWN_CONTENT_TYPES` so they can't drift
apart.
"""

from __future__ import annotations

from pydantic import BaseModel


class ContentTypeOption(BaseModel):
    """One selectable auto-ingest content type: its MIME value and a label."""

    value: str
    label: str


KNOWN_CONTENT_TYPES: tuple[ContentTypeOption, ...] = (
    ContentTypeOption(value="text/plain", label="Plain text"),
    ContentTypeOption(value="text/markdown", label="Markdown"),
    ContentTypeOption(value="text/csv", label="CSV"),
    ContentTypeOption(value="application/pdf", label="PDF"),
)

KNOWN_CONTENT_TYPE_VALUES: frozenset[str] = frozenset(
    option.value for option in KNOWN_CONTENT_TYPES
)

DEFAULT_ALLOWED_CONTENT_TYPES: tuple[str, ...] = tuple(
    option.value for option in KNOWN_CONTENT_TYPES
)
