"""Shared constants for the attribution funnel.

Kept separate so `funnel` and `findings` can both import the ingestion-stage
identity without a circular import.
"""

from __future__ import annotations

INGESTION_NODE_ID = "ingestion"
INGESTION_NODE_TYPE = "ingestion"
INGESTION_LABEL = "Indexed coverage"
