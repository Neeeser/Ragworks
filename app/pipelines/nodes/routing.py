"""Routing: split one item stream into user-named branches by a per-item test.

Every other node applies one policy to a whole stream. The router is where a
graph stops being a straight line: each branch carries an expression over the
item's own facts, branches are tried in order, and the first one that holds
takes the item. Items that match nothing leave through the unmatched port —
or, when nothing is wired to it, are dropped and counted in the trace.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel, Field, ValidationError

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.expressions import (
    Expression,
    ExpressionError,
    ExprType,
    ItemValue,
    MetadataValue,
    check_type,
    evaluate,
    parse,
)
from app.pipelines.node import PipelineNodeBase, PipelineValidationIssue
from app.pipelines.node_ports import DynamicPortSpec, dynamic_port_key
from app.pipelines.payloads import Item, ItemBatch, trace_items
from app.pipelines.ports import NodePort, PortKind
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue

if TYPE_CHECKING:
    # Deferred: the registry imports this module to register the node.
    from app.pipelines.registry import NodeRegistry

#: The variable a branch expression reads the item through.
ITEM_VARIABLE = "item"

#: The output port every unmatched item leaves through.
UNMATCHED_PORT = "unmatched"

#: Prefix for the per-branch output port keys.
BRANCH_PORT_PREFIX = "branch"


class RouterBranchError(ValueError):
    """A branch expression that cannot be parsed, typed, or evaluated.

    The node's typed failure: a router whose test does not answer cannot
    route, and quietly sending those items down the unmatched branch would
    make a broken predicate look like a corpus that simply never matched.
    """


class RouterBranch(BaseModel):
    """One named branch: an output port and the test that fills it.

    `id` is the branch's stable identity and is required rather than
    generated — it is what the port key is built from, so a value minted on
    each load would rewrite the port key on every validation pass and
    disconnect the edges already drawn to it.
    """

    id: str = Field(min_length=1)
    name: str = Field(default="", description="What this branch is called on the canvas.")
    expression: str = Field(
        default="",
        description=(
            "A test over the item, e.g. `item.has_image`, `item.score >= 0.5`, "
            'or `item.metadata.section == "finance"`. Branches are tried top '
            "to bottom and the first one that holds takes the item."
        ),
    )


class RouterConfig(BaseModel):
    """Configuration for the router node."""

    branches: list[RouterBranch] = Field(
        default_factory=list,
        title="Branches",
        description=(
            "Named output ports, tried in order. Each carries an expression "
            "over the item — its facets (`item.has_text`, `item.has_image`), "
            "its `item.score` and `item.text_length`, and its metadata "
            "(`item.metadata.<key>`, empty for an item that carries no such "
            "key). With no branches configured every item leaves through "
            "Unmatched."
        ),
    )


class RouterNode(PipelineNodeBase[RouterConfig]):
    """Send each item down the first branch whose expression holds."""

    type = "route.branch"
    label = "Router"
    category = "utility"
    description = (
        "Split one item stream into named branches by a per-item test. Each "
        "branch carries an expression over the item's own facts — which facets "
        "it has, its score and text length, its metadata — and branches are "
        "tried top to bottom, so the first one that holds takes the item and "
        "no item ever reaches two branches. Items matching no branch leave "
        "through Unmatched; with nothing wired there they are dropped, and the "
        "trace counts them. Items keep every facet they arrived with, so a "
        "branch can feed anything the input could. A branch that receives no "
        "items emits an empty stream like any other."
    )
    example = (
        'Branches: "Images" (item.has_image), "Long text" '
        "(item.text_length > 500). Items(png, short.txt, long.txt) -> "
        "Images(png), Long text(long.txt), Unmatched(short.txt)."
    )
    input_ports = (NodePort(key="items", label="Items", data_type=PortKind.ITEMS),)
    output_ports = (
        NodePort(
            key=UNMATCHED_PORT,
            label="Unmatched",
            data_type=PortKind.ITEMS,
            preserves=True,
        ),
    )
    dynamic_output_ports = DynamicPortSpec(
        config_field="branches",
        key_prefix=BRANCH_PORT_PREFIX,
        template=NodePort(
            key="",
            label="",
            data_type=PortKind.ITEMS,
            preserves=True,
        ),
    )
    config_model = RouterConfig

    def __init__(self, config: RouterConfig) -> None:
        """Track per-branch counts so the trace can report the split."""
        super().__init__(config)
        self._counts: dict[str, int] = {}
        self._dropped = 0

    def run(self, inputs: dict[str, object], _context: PipelineRunContext) -> dict[str, object]:
        """Partition the input stream across the branch ports, in order."""
        batch = self._input_batch(inputs)
        tests = self._compiled_branches()
        buckets: dict[str, list[Item]] = {
            dynamic_port_key(BRANCH_PORT_PREFIX, branch.id): [] for branch in self.config.branches
        }
        unmatched: list[Item] = []
        for item in batch.items:
            self._route(item, tests, buckets, unmatched)
        self._counts = {key: len(items) for key, items in buckets.items()}
        self._dropped = len(unmatched)
        outputs: dict[str, object] = {
            key: batch.model_copy(update={"items": items}) for key, items in buckets.items()
        }
        outputs[UNMATCHED_PORT] = batch.model_copy(update={"items": unmatched})
        return outputs

    @staticmethod
    def _input_batch(inputs: dict[str, object]) -> ItemBatch:
        """Read the inbound stream, as the node's own error when nothing arrived.

        A raw `ValidationError` here reads as a bug in the payload rather than
        as the graph's actual problem — an items input with no edge wired to
        it, which the trace should name.
        """
        try:
            return ItemBatch.model_validate(inputs.get("items"))
        except ValidationError as error:
            raise RouterBranchError(
                "The router received no items — connect a stream to its input."
            ) from error

    def _route(
        self,
        item: Item,
        tests: list[tuple[str, Expression]],
        buckets: dict[str, list[Item]],
        unmatched: list[Item],
    ) -> None:
        """Place one item in the first branch whose test holds, else unmatched."""
        environment = {ITEM_VARIABLE: item_value(item)}
        for key, expression in tests:
            try:
                result = evaluate(expression, environment)
            except ExpressionError as error:
                raise RouterBranchError(
                    f"Branch expression failed on item '{item.id}': {error.message}."
                ) from error
            if not isinstance(result, bool):
                raise RouterBranchError(
                    f"Branch expression must answer true or false, not {result!r}."
                )
            if result:
                buckets[key].append(item)
                return
        unmatched.append(item)

    def _compiled_branches(self) -> list[tuple[str, Expression]]:
        """Parse every branch expression once per run, in declaration order.

        A branch with no expression yet routes nothing rather than failing
        the run: an unfinished branch on a canvas is an ordinary editing
        state, and its port simply stays empty.
        """
        compiled: list[tuple[str, Expression]] = []
        for branch in self.config.branches:
            if not branch.expression.strip():
                continue
            try:
                compiled.append(
                    (dynamic_port_key(BRANCH_PORT_PREFIX, branch.id), parse(branch.expression))
                )
            except ExpressionError as error:
                raise RouterBranchError(
                    f"Branch '{branch_label(branch)}': {error.message}."
                ) from error
        return compiled

    @classmethod
    def validation_issues_for_node(
        cls,
        _node: PipelineNodeDefinition,
        _definition: PipelineDefinition,
        _registry: NodeRegistry,
    ) -> list[PipelineValidationIssue]:
        """Report branch expressions that cannot parse or do not answer true/false.

        Caught at save time rather than at run time: a router is the one
        node whose misconfiguration fails a run *per item*, so a definition
        that only reveals it on the next ingestion is a corpus half-routed
        before anyone finds out.
        """
        try:
            config = RouterConfig.model_validate(_node.config or {})
        except ValidationError:
            return [
                PipelineValidationIssue(
                    message="Router branches are malformed.",
                    code="router.branches",
                    node_id=_node.id,
                    field="branches",
                )
            ]
        issues = _duplicate_branch_issues(config, _node.id)
        for branch in config.branches:
            issues.extend(_branch_expression_issues(branch, _node.id))
        return issues

    def summarize_io(
        self,
        inputs: dict[str, object],
        _outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize the incoming stream against the per-branch split."""
        input_batch = ItemBatch.model_validate(inputs.get("items"))
        routed = [
            {
                "branch": branch_label(branch),
                "expression": branch.expression,
                "items": self._counts.get(dynamic_port_key(BRANCH_PORT_PREFIX, branch.id), 0),
            }
            for branch in self.config.branches
        ]
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(label="Routed", value={"items": len(input_batch.items)}),
                NodeTraceValue(
                    label="Routed items", value=trace_items(input_batch.items), kind="items"
                ),
            ],
            outputs=[
                NodeTraceValue(label="Branches", value={"branches": routed}),
                NodeTraceValue(label="Unmatched", value={"items": self._dropped}),
            ],
        )


def _duplicate_branch_issues(config: RouterConfig, node_id: str) -> list[PipelineValidationIssue]:
    """Flag branch ids that repeat.

    Two branches sharing an id share one output port, so the second is
    unreachable — its items land on the first branch's wire, and nothing on
    the canvas shows which branch actually ran.
    """
    seen: set[str] = set()
    repeated: list[str] = []
    for branch in config.branches:
        if branch.id in seen and branch.id not in repeated:
            repeated.append(branch.id)
        seen.add(branch.id)
    return [
        PipelineValidationIssue(
            message=f"Two branches share the id '{branch_id}', so they share one output port.",
            code="router.duplicate_branch",
            node_id=node_id,
            field="branches",
        )
        for branch_id in repeated
    ]


def _branch_expression_issues(branch: RouterBranch, node_id: str) -> list[PipelineValidationIssue]:
    """Type one branch's expression, reporting anything that cannot route."""
    source = branch.expression.strip()
    if not source:
        return [
            PipelineValidationIssue(
                message=(
                    f"Branch '{branch_label(branch)}' has no expression, so nothing reaches it."
                ),
                severity="warning",
                code="router.empty_branch",
                node_id=node_id,
                field="branches",
            )
        ]
    try:
        result = check_type(parse(source), {ITEM_VARIABLE: ExprType.ITEM})
    except ExpressionError as error:
        return [
            PipelineValidationIssue(
                message=f"Branch '{branch_label(branch)}': {error.message}.",
                code="router.branch_expression",
                node_id=node_id,
                field="branches",
            )
        ]
    if result is not ExprType.BOOLEAN:
        return [
            PipelineValidationIssue(
                message=(
                    f"Branch '{branch_label(branch)}' must answer true or false, "
                    f"but its expression is a {result}."
                ),
                code="router.branch_expression",
                node_id=node_id,
                field="branches",
            )
        ]
    return []


def branch_label(branch: RouterBranch) -> str:
    """What a message calls this branch: its name, falling back to its id."""
    return branch.name.strip() or branch.id


def item_value(item: Item) -> ItemValue:
    """Project an item onto the expression-layer value a branch test reads.

    Facets are read off the item itself rather than off the arriving port's
    declaration, because a stream a node only partly processed carries items
    whose facets differ from what the port claimed. Metadata values are
    stringified: the expression layer types metadata members as strings,
    since nothing can enumerate a corpus's keys to type them individually.
    """
    facets = item.facets()
    return ItemValue(
        id=item.id,
        document_id=item.document_id or "",
        text=item.text or "",
        text_length=len(item.text or ""),
        score=item.score if item.score is not None else 0.0,
        has_file="file" in facets,
        has_text="text" in facets,
        has_image="image" in facets,
        has_embedding="embedding" in facets,
        has_score="score" in facets,
        metadata=MetadataValue(data={key: str(value) for key, value in item.metadata.data.items()}),
    )
