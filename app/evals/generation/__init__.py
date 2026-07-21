"""Synthetic eval dataset generation from a user collection.

Public API: the background entry point the datasets route schedules.
"""

from app.evals.generation.generator import run_dataset_generation

__all__ = ["run_dataset_generation"]
