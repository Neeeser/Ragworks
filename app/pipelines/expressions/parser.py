"""Lexer, AST, and parser for pipeline expressions.

One module owns "source text -> AST". The grammar is deliberately small —
arithmetic, a fixed builtin set, string concatenation, and member access on
model variables:

    expr           := additive
    additive       := multiplicative (("+" | "-") multiplicative)*
    multiplicative := unary (("*" | "//" | "/" | "%") unary)*
    unary          := "-" unary | postfix
    postfix        := primary ("." IDENT)*
    primary        := INT | FLOAT | STRING | "true" | "false"
                    | IDENT | IDENT "(" expr ("," expr)* ")" | "(" expr ")"

This grammar is mirrored in TypeScript (`frontend/src/lib/expressions/`) for
live editor feedback; the shared vector suite in
`tests/assets/expression_vectors.json` pins both implementations to identical
behavior. Grammar changes must update both sides and the vectors.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from app.pipelines.expressions.errors import ExpressionSyntaxError


class TokenKind(StrEnum):
    """Lexical token categories."""

    INT = "int"
    FLOAT = "float"
    STRING = "string"
    IDENT = "ident"
    OP = "op"
    EOF = "eof"


@dataclass(frozen=True)
class Token:
    """One lexical token with its character offset in the source."""

    kind: TokenKind
    text: str
    position: int


_OPERATORS = ("//", "+", "-", "*", "/", "%", "(", ")", ",", ".")
_ESCAPES = {"\\": "\\", '"': '"', "'": "'", "n": "\n", "t": "\t"}
_KEYWORDS = ("true", "false")


def tokenize(source: str) -> list[Token]:
    """Lex the source into tokens, ending with an EOF token."""
    tokens: list[Token] = []
    index = 0
    length = len(source)
    while index < length:
        char = source[index]
        if char.isspace():
            index += 1
            continue
        if char.isdigit():
            index = _lex_number(source, index, tokens)
            continue
        if char.isalpha() or char == "_":
            start = index
            while index < length and (source[index].isalnum() or source[index] == "_"):
                index += 1
            tokens.append(Token(TokenKind.IDENT, source[start:index], start))
            continue
        if char in ('"', "'"):
            index = _lex_string(source, index, tokens)
            continue
        operator = next((op for op in _OPERATORS if source.startswith(op, index)), None)
        if operator is None:
            raise ExpressionSyntaxError(f"Unexpected character {char!r}", index)
        tokens.append(Token(TokenKind.OP, operator, index))
        index += len(operator)
    tokens.append(Token(TokenKind.EOF, "", length))
    return tokens


def _lex_number(source: str, start: int, tokens: list[Token]) -> int:
    """Lex an integer or float literal; return the index after it."""
    index = start
    while index < len(source) and source[index].isdigit():
        index += 1
    if index < len(source) and source[index] == ".":
        fraction = index + 1
        if fraction >= len(source) or not source[fraction].isdigit():
            raise ExpressionSyntaxError("Expected digits after decimal point", index)
        index = fraction
        while index < len(source) and source[index].isdigit():
            index += 1
        tokens.append(Token(TokenKind.FLOAT, source[start:index], start))
    else:
        tokens.append(Token(TokenKind.INT, source[start:index], start))
    return index


def _lex_string(source: str, start: int, tokens: list[Token]) -> int:
    """Lex a quoted string literal; return the index after the closing quote."""
    quote = source[start]
    index = start + 1
    parts: list[str] = []
    while index < len(source):
        char = source[index]
        if char == quote:
            tokens.append(Token(TokenKind.STRING, "".join(parts), start))
            return index + 1
        if char == "\\":
            if index + 1 >= len(source):
                break
            escape = source[index + 1]
            if escape not in _ESCAPES:
                raise ExpressionSyntaxError(f"Unknown escape sequence \\{escape}", index)
            parts.append(_ESCAPES[escape])
            index += 2
            continue
        parts.append(char)
        index += 1
    raise ExpressionSyntaxError("Unterminated string literal", start)


@dataclass(frozen=True)
class Expression:
    """Base AST node; `position` is the character offset in the source."""

    position: int


@dataclass(frozen=True)
class IntLiteral(Expression):
    """Integer literal."""

    value: int


@dataclass(frozen=True)
class NumberLiteral(Expression):
    """Float literal."""

    value: float


@dataclass(frozen=True)
class StringLiteral(Expression):
    """String literal (escapes already resolved)."""

    value: str


@dataclass(frozen=True)
class BooleanLiteral(Expression):
    """`true` / `false` literal."""

    value: bool


@dataclass(frozen=True)
class Name(Expression):
    """Variable reference."""

    name: str


@dataclass(frozen=True)
class Member(Expression):
    """Member access (`base.attribute`) — valid only on model values."""

    base: Expression
    attribute: str


@dataclass(frozen=True)
class Unary(Expression):
    """Unary negation."""

    operand: Expression


@dataclass(frozen=True)
class Binary(Expression):
    """Binary operation: one of + - * / // %."""

    op: str
    left: Expression
    right: Expression


@dataclass(frozen=True)
class Call(Expression):
    """Builtin function call."""

    name: str
    args: tuple[Expression, ...] = field(default_factory=tuple)


_ADDITIVE = ("+", "-")
_MULTIPLICATIVE = ("*", "//", "/", "%")


class _Parser:
    """Recursive-descent parser over the token stream."""

    def __init__(self, tokens: list[Token]) -> None:
        self._tokens = tokens
        self._index = 0

    @property
    def _current(self) -> Token:
        return self._tokens[self._index]

    def _advance(self) -> Token:
        token = self._current
        self._index += 1
        return token

    def _match_op(self, *operators: str) -> Token | None:
        token = self._current
        if token.kind is TokenKind.OP and token.text in operators:
            return self._advance()
        return None

    def _expect_op(self, operator: str, context: str) -> Token:
        token = self._match_op(operator)
        if token is None:
            raise ExpressionSyntaxError(
                f"Expected '{operator}' {context}", self._current.position
            )
        return token

    def parse(self) -> Expression:
        expr = self._additive()
        if self._current.kind is not TokenKind.EOF:
            raise ExpressionSyntaxError(
                f"Unexpected {self._current.text!r} after expression",
                self._current.position,
            )
        return expr

    def _additive(self) -> Expression:
        left = self._multiplicative()
        while (token := self._match_op(*_ADDITIVE)) is not None:
            left = Binary(token.position, token.text, left, self._multiplicative())
        return left

    def _multiplicative(self) -> Expression:
        left = self._unary()
        while (token := self._match_op(*_MULTIPLICATIVE)) is not None:
            left = Binary(token.position, token.text, left, self._unary())
        return left

    def _unary(self) -> Expression:
        if (token := self._match_op("-")) is not None:
            return Unary(token.position, self._unary())
        return self._postfix()

    def _postfix(self) -> Expression:
        expr = self._primary()
        while (token := self._match_op(".")) is not None:
            attribute = self._advance()
            if attribute.kind is not TokenKind.IDENT:
                raise ExpressionSyntaxError(
                    "Expected a member name after '.'", token.position
                )
            expr = Member(token.position, expr, attribute.text)
        return expr

    def _primary(self) -> Expression:
        token = self._advance()
        if token.kind is TokenKind.INT:
            return IntLiteral(token.position, int(token.text))
        if token.kind is TokenKind.FLOAT:
            return NumberLiteral(token.position, float(token.text))
        if token.kind is TokenKind.STRING:
            return StringLiteral(token.position, token.text)
        if token.kind is TokenKind.IDENT:
            if token.text in _KEYWORDS:
                return BooleanLiteral(token.position, token.text == "true")
            if self._match_op("(") is not None:
                return self._call(token)
            return Name(token.position, token.text)
        if token.kind is TokenKind.OP and token.text == "(":
            expr = self._additive()
            self._expect_op(")", "to close '('")
            return expr
        if token.kind is TokenKind.EOF:
            raise ExpressionSyntaxError("Expression is incomplete", token.position)
        raise ExpressionSyntaxError(f"Unexpected {token.text!r}", token.position)

    def _call(self, name: Token) -> Expression:
        args: list[Expression] = []
        if self._match_op(")") is not None:
            return Call(name.position, name.text, tuple(args))
        args.append(self._additive())
        while self._match_op(",") is not None:
            args.append(self._additive())
        self._expect_op(")", f"to close {name.text}(...)")
        return Call(name.position, name.text, tuple(args))


def parse(source: str) -> Expression:
    """Parse expression source text into an AST.

    Raises `ExpressionSyntaxError` (with a character position) on malformed
    input, including empty/blank source.
    """
    if not source.strip():
        raise ExpressionSyntaxError("Expression is empty")
    return _Parser(tokenize(source)).parse()
