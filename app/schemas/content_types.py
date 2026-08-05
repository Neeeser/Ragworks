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
    ContentTypeOption(value="image/png", label="PNG image"),
    ContentTypeOption(value="image/jpeg", label="JPEG image"),
    ContentTypeOption(value="image/webp", label="WebP image"),
    ContentTypeOption(value="image/gif", label="GIF image"),
)

KNOWN_CONTENT_TYPE_VALUES: frozenset[str] = frozenset(
    option.value for option in KNOWN_CONTENT_TYPES
)

#: Auto-ingest defaults stay text-shaped: an image reaching a pipeline with
#: no image path fails per file, so enabling image auto-ingestion is the
#: admin's statement that their pipelines handle images. Selecting one of
#: the image types above is how they make it.
DEFAULT_ALLOWED_CONTENT_TYPES: tuple[str, ...] = (
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/pdf",
)

#: Content types the image-source node accepts, and what the file-type
#: router branches to its `image` port. Kept beside the catalog so the two
#: cannot name different sets.
IMAGE_CONTENT_TYPES: frozenset[str] = frozenset(
    option.value for option in KNOWN_CONTENT_TYPES if option.value.startswith("image/")
)
