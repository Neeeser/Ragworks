"""Typed error taxonomy for pipeline expressions.

All three phases (parse, static type check, evaluation) raise subclasses of
`ExpressionError` carrying the character `position` in the source, so callers
(editor validation, run-time resolution) can surface field-addressable
messages without string-matching.
"""

from __future__ import annotations


class ExpressionError(Exception):
    """Base error for pipeline expression parsing, checking, and evaluation."""

    def __init__(self, message: str, position: int = 0) -> None:
        """Store the human-readable message and source character offset."""
        super().__init__(message)
        self.message = message
        self.position = position


class ExpressionSyntaxError(ExpressionError):
    """The source text is not a well-formed expression."""


class ExpressionTypeError(ExpressionError):
    """The expression is well-formed but ill-typed for its environment."""


class ExpressionEvalError(ExpressionError):
    """A well-typed expression failed at evaluation time (e.g. divide by zero)."""
