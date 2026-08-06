"""Trace summaries for the file and image streams nodes read and write.

Shared by the ingestion input and every parse node so one stream always
describes itself the same way — the trace viewer picks a card by the
summary's key set, and a file summary carrying different keys at each
node would render as a different kind of thing.
"""

from __future__ import annotations

from app.pipelines.payloads import ItemBatch

#: How many paths or dimensions a summary lists before it stops. A trace
#: is read by a person; the full list is in the item trace beside it.
_SAMPLE_LIMIT = 10


def file_summary(batch: ItemBatch) -> dict[str, object]:
    """Describe a file stream: what it holds, of what type and size."""
    files = [item.file for item in batch.items if item.file is not None]
    return {
        "count": len(files),
        "media_types": sorted({asset.media_type for asset in files}),
        "paths": [asset.path for asset in files[:_SAMPLE_LIMIT]],
        "byte_size": sum(asset.byte_size for asset in files),
    }


def image_summary(batch: ItemBatch) -> dict[str, object]:
    """Describe an image stream: how many, of what, and how big."""
    images = [item.image for item in batch.items if item.image is not None]
    return {
        "count": len(images),
        "media_types": sorted({image.media_type for image in images}),
        "dimensions": [
            f"{image.width}x{image.height}" if image.width and image.height else "unknown"
            for image in images[:_SAMPLE_LIMIT]
        ],
    }
