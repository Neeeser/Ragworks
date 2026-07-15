"""Tokenizer resource nodes used by document chunkers."""

from __future__ import annotations

from typing import TYPE_CHECKING, Generic, Literal, TypeVar

from pydantic import BaseModel, ValidationError, field_validator

from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import EmptyConfig, PipelineNodeBase, PipelineValidationIssue
from app.pipelines.payloads import TokenizerSpec
from app.pipelines.ports import NodePort
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.retrieval.tokenizers.huggingface import validate_hf_model_id

TokenizerConfigT = TypeVar("TokenizerConfigT", bound=BaseModel)
TokenizerKind = Literal["wordpiece", "cl100k", "whitespace", "huggingface"]

if TYPE_CHECKING:
    from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
    from app.pipelines.registry import NodeRegistry


class BaseTokenizerNode(Generic[TokenizerConfigT], PipelineNodeBase[TokenizerConfigT]):
    """Shared output behavior for tokenizer resource nodes."""

    category = "ingestion"
    input_ports = ()
    output_ports = (
        NodePort(key="tokenizer", label="Tokenizer", data_type="tokenizer"),
    )
    tokenizer_kind: TokenizerKind

    def tokenizer_spec(self) -> TokenizerSpec:
        """Return the immutable payload emitted by this node."""
        return TokenizerSpec(kind=self.tokenizer_kind)

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Emit the configured tokenizer selection."""
        return {"tokenizer": self.tokenizer_spec()}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Record the selected tokenizer in the run trace."""
        spec = TokenizerSpec.model_validate(outputs.get("tokenizer"))
        return NodeTraceSummary(
            outputs=[NodeTraceValue(label="Tokenizer", value=spec.model_dump())]
        )


class WordPieceTokenizerNode(BaseTokenizerNode[EmptyConfig]):
    """Bundled BERT WordPiece tokenizer resource."""

    type = "tokenizer.wordpiece"
    label = "BERT WordPiece"
    description = "Counts BERT WordPiece tokens used by MiniLM, bge, e5, and gte models."
    example = "No input -> TokenizerSpec(kind='wordpiece')."
    config_model = EmptyConfig
    tokenizer_kind = "wordpiece"


class Cl100kTokenizerNode(BaseTokenizerNode[EmptyConfig]):
    """Bundled OpenAI cl100k tokenizer resource."""

    type = "tokenizer.cl100k"
    label = "cl100k"
    description = "Counts cl100k tokens used by OpenAI embedding models."
    example = "No input -> TokenizerSpec(kind='cl100k')."
    config_model = EmptyConfig
    tokenizer_kind = "cl100k"


class WhitespaceTokenizerNode(BaseTokenizerNode[EmptyConfig]):
    """Legacy whitespace tokenizer resource."""

    type = "tokenizer.whitespace"
    label = "Whitespace"
    description = "Counts whitespace-separated words and undercounts model tokens."
    example = "No input -> TokenizerSpec(kind='whitespace')."
    config_model = EmptyConfig
    tokenizer_kind = "whitespace"


class HuggingFaceTokenizerConfig(BaseModel):
    """Configuration for a cached HuggingFace tokenizer JSON file."""

    hf_model_id: str = ""

    @field_validator("hf_model_id")
    @classmethod
    def validate_model_id(cls, value: str) -> str:
        """Reject path traversal and identifiers outside HF repository syntax."""
        if not value:
            return value
        return validate_hf_model_id(value)


class HuggingFaceTokenizerNode(BaseTokenizerNode[HuggingFaceTokenizerConfig]):
    """User-selected HuggingFace tokenizer resource."""

    type = "tokenizer.huggingface"
    label = "HuggingFace tokenizer"
    description = "Counts tokens with a tokenizer.json downloaded from huggingface.co."
    example = "No input -> TokenizerSpec(kind='huggingface', hf_model_id='owner/model')."
    config_model = HuggingFaceTokenizerConfig
    tokenizer_kind = "huggingface"

    @classmethod
    def validation_issues_for_node(
        cls,
        node: PipelineNodeDefinition,
        _definition: PipelineDefinition,
        _registry: NodeRegistry,
    ) -> list[PipelineValidationIssue]:
        """Require a repository id before a HuggingFace tokenizer can be saved."""
        try:
            config = cls.config_model.model_validate(node.config)
        except ValidationError:
            return [
                PipelineValidationIssue(
                    message=f"Node '{node.id}' has an invalid HuggingFace model id.",
                    node_id=node.id,
                    field="hf_model_id",
                )
            ]
        if config.hf_model_id:
            return []
        return [
            PipelineValidationIssue(
                message=f"Node '{node.id}' requires a HuggingFace model id.",
                node_id=node.id,
                field="hf_model_id",
            )
        ]

    def tokenizer_spec(self) -> TokenizerSpec:
        """Include the configured repository id in the emitted spec."""
        return TokenizerSpec(kind="huggingface", hf_model_id=self.config.hf_model_id)

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Require a cached tokenizer or the user's remembered download consent."""
        from app.services.huggingface_tokenizers import HuggingFaceTokenizerService

        spec = self.tokenizer_spec()
        HuggingFaceTokenizerService(
            context.session,
            context.storage.base_path,
        ).ensure_available(context.user, self.config.hf_model_id)
        return {"tokenizer": spec}
