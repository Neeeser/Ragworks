"""Inline binary media handed to a model.

One shape for every provider surface that takes bytes rather than text —
vision chat messages and multimodal embeddings both encode the same
`(media_type, data)` pair, so they share a model rather than each defining
their own and drifting on what counts as a media type.
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
