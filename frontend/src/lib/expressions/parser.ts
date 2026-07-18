/**
 * Lexer, AST, and parser for pipeline expressions — the TypeScript mirror of
 * `app/pipelines/expressions/parser.py`. Grammar changes must land on both
 * sides and in the shared vectors (`tests/assets/expression_vectors.json`).
 *
 *   expr           := additive
 *   additive       := multiplicative (("+" | "-") multiplicative)*
 *   multiplicative := unary (("*" | "//" | "/" | "%") unary)*
 *   unary          := "-" unary | postfix
 *   postfix        := primary ("." IDENT)*
 *   primary        := INT | FLOAT | STRING | "true" | "false"
 *                   | IDENT | IDENT "(" expr ("," expr)* ")" | "(" expr ")"
 */

import { syntaxError } from "./errors";

export type BinaryOp = "+" | "-" | "*" | "/" | "//" | "%";

export type Expression =
  | { kind: "int"; value: number; position: number }
  | { kind: "float"; value: number; position: number }
  | { kind: "string"; value: string; position: number }
  | { kind: "boolean"; value: boolean; position: number }
  | { kind: "name"; name: string; position: number }
  | { kind: "member"; base: Expression; attribute: string; position: number }
  | { kind: "unary"; operand: Expression; position: number }
  | { kind: "binary"; op: BinaryOp; left: Expression; right: Expression; position: number }
  | { kind: "call"; name: string; args: Expression[]; position: number };

type TokenKind = "int" | "float" | "string" | "ident" | "op" | "eof";

interface Token {
  kind: TokenKind;
  text: string;
  position: number;
}

const OPERATORS = ["//", "+", "-", "*", "/", "%", "(", ")", ",", "."] as const;
const ESCAPES: Record<string, string> = { "\\": "\\", '"': '"', "'": "'", n: "\n", t: "\t" };

const isDigit = (char: string) => char >= "0" && char <= "9";
const isIdentStart = (char: string) => /[A-Za-z_]/.test(char);
const isIdentPart = (char: string) => /[A-Za-z0-9_]/.test(char);

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (isDigit(char)) {
      index = lexNumber(source, index, tokens);
      continue;
    }
    if (isIdentStart(char)) {
      const start = index;
      while (index < source.length && isIdentPart(source[index])) index += 1;
      tokens.push({ kind: "ident", text: source.slice(start, index), position: start });
      continue;
    }
    if (char === '"' || char === "'") {
      index = lexString(source, index, tokens);
      continue;
    }
    const operator = OPERATORS.find((op) => source.startsWith(op, index));
    if (!operator) {
      throw syntaxError(`Unexpected character '${char}'`, index);
    }
    tokens.push({ kind: "op", text: operator, position: index });
    index += operator.length;
  }
  tokens.push({ kind: "eof", text: "", position: source.length });
  return tokens;
}

function lexNumber(source: string, start: number, tokens: Token[]): number {
  let index = start;
  while (index < source.length && isDigit(source[index])) index += 1;
  if (index < source.length && source[index] === ".") {
    const fraction = index + 1;
    if (fraction >= source.length || !isDigit(source[fraction])) {
      throw syntaxError("Expected digits after decimal point", index);
    }
    index = fraction;
    while (index < source.length && isDigit(source[index])) index += 1;
    tokens.push({ kind: "float", text: source.slice(start, index), position: start });
  } else {
    tokens.push({ kind: "int", text: source.slice(start, index), position: start });
  }
  return index;
}

function lexString(source: string, start: number, tokens: Token[]): number {
  const quote = source[start];
  let index = start + 1;
  const parts: string[] = [];
  while (index < source.length) {
    const char = source[index];
    if (char === quote) {
      tokens.push({ kind: "string", text: parts.join(""), position: start });
      return index + 1;
    }
    if (char === "\\") {
      if (index + 1 >= source.length) break;
      const escape = source[index + 1];
      if (!(escape in ESCAPES)) {
        throw syntaxError(`Unknown escape sequence \\${escape}`, index);
      }
      parts.push(ESCAPES[escape]);
      index += 2;
      continue;
    }
    parts.push(char);
    index += 1;
  }
  throw syntaxError("Unterminated string literal", start);
}

const ADDITIVE: readonly string[] = ["+", "-"];
const MULTIPLICATIVE: readonly string[] = ["*", "//", "/", "%"];

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  private get current(): Token {
    return this.tokens[this.index];
  }

  private advance(): Token {
    const token = this.current;
    this.index += 1;
    return token;
  }

  private matchOp(...operators: string[]): Token | null {
    const token = this.current;
    if (token.kind === "op" && operators.includes(token.text)) {
      return this.advance();
    }
    return null;
  }

  private expectOp(operator: string, context: string): void {
    if (!this.matchOp(operator)) {
      throw syntaxError(`Expected '${operator}' ${context}`, this.current.position);
    }
  }

  parse(): Expression {
    const expr = this.additive();
    if (this.current.kind !== "eof") {
      throw syntaxError(
        `Unexpected '${this.current.text}' after expression`,
        this.current.position,
      );
    }
    return expr;
  }

  private additive(): Expression {
    let left = this.multiplicative();
    let token = this.matchOp(...ADDITIVE);
    while (token) {
      left = {
        kind: "binary",
        op: token.text as BinaryOp,
        left,
        right: this.multiplicative(),
        position: token.position,
      };
      token = this.matchOp(...ADDITIVE);
    }
    return left;
  }

  private multiplicative(): Expression {
    let left = this.unary();
    let token = this.matchOp(...MULTIPLICATIVE);
    while (token) {
      left = {
        kind: "binary",
        op: token.text as BinaryOp,
        left,
        right: this.unary(),
        position: token.position,
      };
      token = this.matchOp(...MULTIPLICATIVE);
    }
    return left;
  }

  private unary(): Expression {
    const token = this.matchOp("-");
    if (token) {
      return { kind: "unary", operand: this.unary(), position: token.position };
    }
    return this.postfix();
  }

  private postfix(): Expression {
    let expr = this.primary();
    let token = this.matchOp(".");
    while (token) {
      const attribute = this.advance();
      if (attribute.kind !== "ident") {
        throw syntaxError("Expected a member name after '.'", token.position);
      }
      expr = { kind: "member", base: expr, attribute: attribute.text, position: token.position };
      token = this.matchOp(".");
    }
    return expr;
  }

  private primary(): Expression {
    const token = this.advance();
    if (token.kind === "int") {
      return { kind: "int", value: Number.parseInt(token.text, 10), position: token.position };
    }
    if (token.kind === "float") {
      return { kind: "float", value: Number.parseFloat(token.text), position: token.position };
    }
    if (token.kind === "string") {
      return { kind: "string", value: token.text, position: token.position };
    }
    if (token.kind === "ident") {
      if (token.text === "true" || token.text === "false") {
        return { kind: "boolean", value: token.text === "true", position: token.position };
      }
      if (this.matchOp("(")) {
        return this.call(token);
      }
      return { kind: "name", name: token.text, position: token.position };
    }
    if (token.kind === "op" && token.text === "(") {
      const expr = this.additive();
      this.expectOp(")", "to close '('");
      return expr;
    }
    if (token.kind === "eof") {
      throw syntaxError("Expression is incomplete", token.position);
    }
    throw syntaxError(`Unexpected '${token.text}'`, token.position);
  }

  private call(name: Token): Expression {
    const args: Expression[] = [];
    if (this.matchOp(")")) {
      return { kind: "call", name: name.text, args, position: name.position };
    }
    args.push(this.additive());
    while (this.matchOp(",")) {
      args.push(this.additive());
    }
    this.expectOp(")", `to close ${name.text}(...)`);
    return { kind: "call", name: name.text, args, position: name.position };
  }
}

/** Parse expression source into an AST; throws a syntax `ExpressionError`. */
export function parse(source: string): Expression {
  if (!source.trim()) {
    throw syntaxError("Expression is empty");
  }
  return new Parser(tokenize(source)).parse();
}
