"""Content types whose file already is the content the pipeline indexes."""

from __future__ import annotations

from app.schemas.content_types import IMAGE_CONTENT_TYPES

#: Types the Media File node emits directly as a media item. Audio and
#: video join this set with the facets that carry them.
MEDIA_FILE_TYPES: frozenset[str] = IMAGE_CONTENT_TYPES
