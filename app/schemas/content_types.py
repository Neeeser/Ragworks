"""The auto-ingest content-type catalog: single source of truth.

`uploads.allowed_content_types` (`app/schemas/app_config.py`) must offer and
accept only MIME types the shipped parsers actually handle
(`app/retrieval/parsers/`) — otherwise an admin can enable auto-ingestion for
a type nothing can parse. Both the config default and the admin catalog's
selectable options are built from `KNOWN_CONTENT_TYPES` so they can't drift
apart.

The catalog also names the file extension each type is written with, so every
place that materializes bytes under a derived name (eval dataset media, eval
corpus files) spells a type's suffix the same way and the name still maps back
to the type it came from.
"""

from __future__ import annotations

from collections.abc import Mapping

from pydantic import BaseModel


class ContentTypeOption(BaseModel):
    """One catalog content type: its MIME value, label, and file extension."""

    value: str
    label: str
    extension: str


KNOWN_CONTENT_TYPES: tuple[ContentTypeOption, ...] = (
    ContentTypeOption(value="text/plain", label="Plain text", extension=".txt"),
    ContentTypeOption(value="text/markdown", label="Markdown", extension=".md"),
    ContentTypeOption(value="text/csv", label="CSV", extension=".csv"),
    ContentTypeOption(value="application/pdf", label="PDF", extension=".pdf"),
    ContentTypeOption(value="image/png", label="PNG image", extension=".png"),
    ContentTypeOption(value="image/jpeg", label="JPEG image", extension=".jpg"),
    ContentTypeOption(value="image/webp", label="WebP image", extension=".webp"),
    ContentTypeOption(value="image/gif", label="GIF image", extension=".gif"),
)

KNOWN_CONTENT_TYPE_VALUES: frozenset[str] = frozenset(
    option.value for option in KNOWN_CONTENT_TYPES
)

#: Every type a shipped parser reads is auto-ingested by default. Whether a
#: particular collection can read one is a property of its pipeline, not of
#: the deployment: an upload whose type no parse node in that graph claims is
#: recorded as unsupported without running, so widening this list never turns
#: an upload into a failure.
DEFAULT_ALLOWED_CONTENT_TYPES: tuple[str, ...] = tuple(
    option.value for option in KNOWN_CONTENT_TYPES
)

#: Content types the image-source node accepts, and what the file-type
#: router branches to its `image` port. Kept beside the catalog so the two
#: cannot name different sets.
IMAGE_CONTENT_TYPES: frozenset[str] = frozenset(
    option.value for option in KNOWN_CONTENT_TYPES if option.value.startswith("image/")
)

#: The file extension each catalog type is stored under.
CONTENT_TYPE_EXTENSIONS: Mapping[str, str] = {
    option.value: option.extension for option in KNOWN_CONTENT_TYPES
}

#: Extension for a type the catalog does not name. Stored bytes still get a
#: name: a benchmark loader reports whatever content type its source declares,
#: and refusing to name those bytes would fail an import over a suffix.
FALLBACK_EXTENSION = ".bin"


def normalize_content_type(content_type: str) -> str:
    """Return a content type without its parameters, lowercased.

    Content types arrive from HTTP headers and dataset metadata, which carry
    `; charset=…` and mixed case: compared raw, `Image/PNG` is a type nobody
    has heard of, and sent on raw it is a media type a provider rejects.
    """
    return content_type.split(";", 1)[0].strip().lower()


def extension_for(content_type: str) -> str:
    """Return the file extension bytes of this content type are stored under."""
    return CONTENT_TYPE_EXTENSIONS.get(normalize_content_type(content_type), FALLBACK_EXTENSION)


def is_image_content_type(content_type: str) -> bool:
    """True when a content type names an image of any format.

    Wider than `IMAGE_CONTENT_TYPES`, which lists the formats the shipped
    parsers read: an image an external dataset ships in a format no parser
    handles is still an image for the purposes of measuring and classifying
    it.
    """
    return normalize_content_type(content_type).startswith("image/")
