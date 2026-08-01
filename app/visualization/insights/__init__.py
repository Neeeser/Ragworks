"""Collection insight engine: vector spaces, projections, and artifacts.

`InsightService` is loaded lazily: the projection subprocess imports
`app.visualization.insights.projection_worker`, and an eager service import
here would drag sklearn (and its OpenMP runtime) into the child this
package exists to keep clean.
"""

from typing import Any

__all__ = ["InsightService"]  # noqa: F822 -- resolved lazily via __getattr__ below


def __getattr__(name: str) -> Any:
    if name == "InsightService":
        from app.visualization.insights.service import InsightService

        return InsightService
    raise AttributeError(name)
