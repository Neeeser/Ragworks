"""Trace summary values shared by the LLM node shells.

The prompt *templates* are recorded (they explain what the node does);
rendered per-item prompts are not persisted — they would multiply chunk
text into every trace row.
"""

from __future__ import annotations

from app.pipelines.llm.config import LlmNodeConfig
from app.pipelines.tracing import NodeTraceValue
from app.pipelines.tracing.summaries import TokenUsage


def llm_call_summary_values(
    config: LlmNodeConfig,
    *,
    mechanism: str | None,
    warnings: list[str],
    retries: int,
    usage: TokenUsage,
) -> list[NodeTraceValue]:
    """Model identity, call accounting, and any degrade warnings."""
    call_info = {
        "connection_id": (
            str(config.connection_id) if config.connection_id is not None else None
        ),
        "model_name": config.model_name,
        "mechanism": mechanism,
        "temperature": config.temperature,
        "system_prompt": config.system_prompt,
        "prompt": config.prompt,
        "output_fields": [
            {
                "name": spec.name,
                "type": spec.type,
                "target": spec.target.kind,
            }
            for spec in config.output_fields
        ],
        "retries": retries,
        "usage": usage.model_dump(),
    }
    values = [NodeTraceValue(label="LLM call", value=call_info, kind="llm_call")]
    if warnings:
        values.append(NodeTraceValue(label="Warnings", value=list(warnings)))
    return values
