"""Captured datasets-server pages, replayed as a `RowsReader`.

The JSON under `tests/assets/hf_rows_*.json` is real `/rows` output from the
two column dialects the registry ships (ViDoRe v2 and REAL-MM-RAG), trimmed to
a handful of rows with the pre-signed image URLs stripped of their expiring
signature. Loader tests read these instead of the live API.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from app.evals.datasets.hf_datasets_server import RowsPage, media_type_from_url

ASSETS = Path(__file__).parent.parent / "assets"

#: A real PNG, so a stored page image has dimensions worth measuring.
IMAGE_BYTES = (ASSETS / "diagram.png").read_bytes()


def load_pages(name: str) -> dict[str, RowsPage]:
    """Load one captured dataset's corpus/queries/qrels pages."""
    raw = json.loads((ASSETS / name).read_text(encoding="utf-8"))
    return {config: RowsPage.model_validate(page) for config, page in raw.items()}


@dataclass
class FixtureReader:
    """Serves captured pages and fixed image bytes, recording what was asked.

    `rows` slices by the requested offset and length exactly as the API does,
    so a caller that pages wrongly reads the same rows twice or stops early.
    """

    pages: dict[str, RowsPage]
    image_bytes: bytes = IMAGE_BYTES
    requests: list[tuple[str, int, int]] = field(default_factory=list)
    fetched: list[str] = field(default_factory=list)

    def rows(self, config: str, offset: int, length: int) -> RowsPage:
        """Return the requested slice of a config's captured rows."""
        self.requests.append((config, offset, length))
        page = self.pages[config]
        return RowsPage(
            rows=page.rows[offset : offset + length],
            num_rows_total=page.num_rows_total,
        )

    def media(self, url: str) -> tuple[str, bytes]:
        """Return the fixed image bytes under the media type the URL names."""
        self.fetched.append(url)
        return media_type_from_url(url), self.image_bytes
