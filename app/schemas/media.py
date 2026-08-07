"""Binary media shapes: inline bytes for a provider, and the wire halves.

`InlineMedia` is what every provider surface taking bytes rather than text
encodes — vision chat messages and multimodal embeddings both send the same
`(media_type, data)` pair, so they share a model rather than each defining
their own and drifting on what counts as a media type.

`QueryMediaPayload` and `MediaAssetRef` are the request and response halves
of media on the query surfaces: a client posts base64 bytes and reads back a
stored reference it fetches through the owning scope's asset route.
"""

from __future__ import annotations

import base64

from pydantic import BaseModel, ConfigDict


class InlineMedia(BaseModel):
    """Raw bytes plus the media type a provider needs to interpret them."""

    model_config = ConfigDict(frozen=True)

    media_type: str
    data: bytes

    def data_uri(self) -> str:
        """Return the base64 data URI form providers accept inline."""
        encoded = base64.b64encode(self.data).decode("ascii")
        return f"data:{self.media_type};base64,{encoded}"


class QueryMediaPayload(BaseModel):
    """One image submitted with a query, as base64 bytes.

    The media type is stated by the client rather than sniffed from the
    bytes, so an unsupported format is refused before anything is decoded
    or written.
    """

    media_type: str
    data: str


class MediaAssetRef(BaseModel):
    """A stored media asset as a client reads it.

    `path` is storage-relative, and is what the owner-scoped asset route
    takes back to stream the bytes — clients render media by handing this
    value to that route, never by holding the bytes themselves.
    """

    media_type: str
    path: str
    byte_size: int
    width: int | None = None
    height: int | None = None
