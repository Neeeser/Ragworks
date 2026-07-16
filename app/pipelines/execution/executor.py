"""Executes a validated pipeline definition against a run context."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.nodes.embedding import EmbedderConfig, EmbedderNode
from app.pipelines.payloads import ChunkPayload
from app.pipelines.registry import NodeRegistry
from app.pipelines.validation import PipelineValidator
from app.services.errors import ServiceError, is_external_provider_error

logger = logging.getLogger(__name__)


class PipelineExecutionError(RuntimeError):
    """Raised when pipeline execution fails."""


@dataclass
class PipelineExecutionResult:
    """Pipeline execution outputs."""

    outputs_by_node: dict[str, dict[str, object]]
    terminal_outputs: dict[str, dict[str, object]]


@dataclass
class _RunState:
    """Mutable bookkeeping for one pipeline run.

    `fanin` starts as the wired inbound-edge count per `(node, port)` and may
    shrink when a branch settles as undeliverable; `dead` holds nodes that can
    never run because no branch delivered to them.
    """

    node_map: dict[str, PipelineNodeDefinition]
    outgoing: dict[str, list[PipelineEdgeDefinition]]
    incoming: dict[str, list[PipelineEdgeDefinition]]
    fanin: dict[tuple[str, str], int]
    inputs: dict[str, dict[str, object]]
    delivered_many: dict[tuple[str, str], dict[str, object]]
    outputs: dict[str, dict[str, object]]
    pending: set[str]
    dead: set[str]

    @classmethod
    def for_definition(cls, definition: PipelineDefinition) -> _RunState:
        """Build the initial state for a definition."""
        node_map = definition.node_map()
        incoming: dict[str, list[PipelineEdgeDefinition]] = {}
        fanin: dict[tuple[str, str], int] = {}
        for edge in definition.edges:
            incoming.setdefault(edge.target, []).append(edge)
            key = (edge.target, edge.target_port or "default")
            fanin[key] = fanin.get(key, 0) + 1
        return cls(
            node_map=node_map,
            outgoing=definition.outgoing_edges(),
            incoming=incoming,
            fanin=fanin,
            inputs={node_id: {} for node_id in node_map},
            delivered_many={},
            outputs={},
            pending=set(node_map.keys()),
            dead=set(),
        )


class PipelineExecutor:
    """Executor for pipeline definitions."""

    def __init__(self, registry: NodeRegistry) -> None:
        """Initialize the executor with a node registry."""
        self._registry = registry
        self._validator = PipelineValidator(registry)

    def execute(
        self,
        definition: PipelineDefinition,
        context: PipelineRunContext,
    ) -> PipelineExecutionResult:
        """Validate then run the pipeline definition and return its outputs."""
        validation = self._validator.validate(definition)
        if not validation.valid:
            error = PipelineExecutionError("; ".join(validation.errors))
            if context.trace:
                context.trace.mark_run_failed(error)
            raise error

        try:
            outputs, terminal_outputs = self._execute_nodes(definition, context)
        except Exception as exc:
            if context.trace:
                context.trace.mark_run_failed(exc)
            raise

        if context.trace:
            context.trace.mark_run_completed()
        return PipelineExecutionResult(outputs_by_node=outputs, terminal_outputs=terminal_outputs)

    def _execute_nodes(
        self,
        definition: PipelineDefinition,
        context: PipelineRunContext,
    ) -> tuple[dict[str, dict[str, object]], dict[str, dict[str, object]]]:
        """Run nodes for a pipeline definition and return outputs."""
        state = _RunState.for_definition(definition)

        while state.pending:
            progressed = False
            for node_id in list(state.pending):
                if not self._is_ready(node_id, state):
                    continue

                node_outputs = self._run_node_traced(
                    state.node_map[node_id], state.inputs[node_id], context
                )
                state.outputs[node_id] = node_outputs
                state.pending.remove(node_id)
                progressed = True
                self._propagate(node_id, node_outputs, state, context)
            if progressed:
                continue
            if not self._settle_undeliverable(state):
                break

        self._resolve_stalled(state.pending, state.inputs)

        terminal_outputs = {
            node_id: node_outputs
            for node_id, node_outputs in state.outputs.items()
            if node_id not in state.outgoing
        }
        return state.outputs, terminal_outputs

    def _settle_undeliverable(self, state: _RunState) -> bool:
        """Settle nodes whose remaining inputs can never arrive; return True on change.

        An upstream node may legitimately emit only a subset of its output
        ports (a router), leaving a branch undelivered. Once every inbound
        edge of a pending node is settled (its source ran or is itself dead):
        a node with no inputs at all is dead — it can never run — and a
        variadic port's expected fan-in shrinks to what actually arrived, so
        the fan-in node runs with the branches that delivered.
        """
        changed = False
        for node_id in list(state.pending):
            edges = state.incoming.get(node_id, [])
            if not all(
                edge.source in state.outputs or edge.source in state.dead for edge in edges
            ):
                continue
            if not state.inputs[node_id] and edges:
                logger.info("Skipping pipeline node %s: no branch delivered to it.", node_id)
                state.pending.remove(node_id)
                state.dead.add(node_id)
                changed = True
                continue
            for edge in edges:
                port_key = edge.target_port or "default"
                key = (node_id, port_key)
                if not self._is_many_port(state.node_map.get(node_id), port_key):
                    continue
                collected = state.inputs[node_id].get(port_key)
                arrived = len(collected) if isinstance(collected, list) else 0
                if arrived > 0 and state.fanin.get(key, 0) != arrived:
                    state.fanin[key] = arrived
                    changed = True
        return changed

    def _is_ready(self, node_id: str, state: _RunState) -> bool:
        """Return True when a pending node has all the inputs it needs to run."""
        node_def = state.node_map[node_id]
        node_spec = self._registry.get_spec(node_def.type)
        if node_spec is None:
            raise PipelineExecutionError(f"Node type '{node_def.type}' not found.")

        available_inputs = state.inputs[node_id]
        if node_spec.input_ports and not available_inputs:
            return False

        for port in node_spec.input_ports:
            if port.accepts_many:
                collected = available_inputs.get(port.key)
                arrived = len(collected) if isinstance(collected, list) else 0
                expected = state.fanin.get((node_id, port.key), 0)
                # A variadic port waits for every wired edge; required with
                # nothing wired can never run (the validator flags it first).
                if arrived < expected or (port.required and expected == 0):
                    return False
            elif port.required and port.key not in available_inputs:
                return False
        return True

    def _run_node_traced(
        self,
        node_def: PipelineNodeDefinition,
        available_inputs: dict[str, object],
        context: PipelineRunContext,
    ) -> dict[str, object]:
        """Instantiate and run a single node, recording trace data when enabled."""
        node = self._registry.create(node_def)
        logger.debug("Executing pipeline node %s (%s)", node_def.id, node_def.type)
        node_run = context.trace.start_node(node_def, available_inputs) if context.trace else None
        try:
            node_outputs = node.run(available_inputs, context)
            summary = (
                node.summarize_io(available_inputs, node_outputs)
                if context.trace and node_run
                else None
            )
        except Exception as exc:
            if context.trace and node_run:
                context.trace.fail_node(node_run, exc)
                context.trace.mark_run_failed(exc)
            raise
        if context.trace and node_run and summary is not None:
            context.trace.finish_node(node_run, node_outputs, summary)
        return node_outputs

    def _propagate(
        self,
        node_id: str,
        node_outputs: dict[str, object],
        state: _RunState,
        context: PipelineRunContext,
    ) -> None:
        """Copy a node's outputs onto its downstream edges' target inputs.

        Values bound for an `accepts_many` port collect into a list; every
        other port receives the single value directly.
        """
        node_outputs = self._guard_fanout_chunks(node_id, node_outputs, state, context)
        for edge in state.outgoing.get(node_id, []):
            output_key = edge.source_port or "default"
            if output_key not in node_outputs:
                continue
            target_inputs = state.inputs[edge.target]
            input_key = edge.target_port or "default"
            if self._is_many_port(state.node_map.get(edge.target), input_key):
                key = (edge.target, input_key)
                delivered = state.delivered_many.setdefault(key, {})
                delivered[edge.id] = node_outputs[output_key]
                target_inputs[input_key] = [
                    delivered[incoming.id]
                    for incoming in state.incoming.get(edge.target, [])
                    if (incoming.target_port or "default") == input_key
                    and incoming.id in delivered
                ]
            else:
                target_inputs[input_key] = node_outputs[output_key]

    @staticmethod
    def _guard_fanout_chunks(
        node_id: str,
        node_outputs: dict[str, object],
        state: _RunState,
        context: PipelineRunContext,
    ) -> dict[str, object]:
        """Apply one downstream embedding guard before hybrid fan-out."""
        payload = node_outputs.get("chunks")
        outgoing = state.outgoing.get(node_id, [])
        if not isinstance(payload, ChunkPayload) or len(outgoing) < 2:
            return node_outputs

        limits: list[int] = []
        for edge in outgoing:
            target = state.node_map.get(edge.target)
            if target is None or target.type != EmbedderNode.type:
                continue
            config = EmbedderConfig.model_validate(target.config or {})
            if config.connection_id is None or not config.model_name:
                continue
            try:
                published = context.providers.embedding_input_limit(
                    config.connection_id, config.model_name
                )
            except Exception as exc:
                if not isinstance(exc, ServiceError) and not is_external_provider_error(exc):
                    raise
                continue
            if published is not None:
                limits.append(published)
        if not limits:
            return node_outputs
        guarded = EmbedderNode.guard_chunks_for_embedding(payload, min(limits), context)
        return {**node_outputs, "chunks": payload.model_copy(update={"chunks": guarded})}

    def _is_many_port(self, node_def: PipelineNodeDefinition | None, port_key: str) -> bool:
        """Return True when the target node declares `port_key` as accepts_many."""
        if node_def is None:
            return False
        spec = self._registry.get_spec(node_def.type)
        if spec is None:
            return False
        return any(port.key == port_key and port.accepts_many for port in spec.input_ports)

    @staticmethod
    def _resolve_stalled(
        pending: set[str],
        inputs: dict[str, dict[str, object]],
    ) -> None:
        """Clear branch nodes stalled with no inputs, or raise if any node had inputs."""
        if not pending:
            return
        stalled_without_inputs = [node_id for node_id in pending if not inputs[node_id]]
        if len(stalled_without_inputs) == len(pending):
            logger.info(
                "Skipping %s branch node(s) with no inputs.",
                len(stalled_without_inputs),
            )
            pending.clear()
            return
        missing_nodes = ", ".join(sorted(pending))
        raise PipelineExecutionError(
            f"Pipeline stalled. Missing inputs for nodes: {missing_nodes}."
        )
