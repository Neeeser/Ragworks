/**
 * Typed errors for pipeline expressions, mirroring the backend taxonomy
 * (`app/pipelines/expressions/errors.py`). `position` is the character
 * offset in the source; `kind` distinguishes parse, static-type, and
 * evaluation failures for the shared conformance vectors.
 */

export type ExpressionErrorKind = "syntax" | "type" | "eval";

export class ExpressionError extends Error {
  readonly kind: ExpressionErrorKind;
  readonly position: number;

  constructor(kind: ExpressionErrorKind, message: string, position = 0) {
    super(message);
    this.name = "ExpressionError";
    this.kind = kind;
    this.position = position;
  }
}

export function syntaxError(message: string, position = 0): ExpressionError {
  return new ExpressionError("syntax", message, position);
}

export function typeError(message: string, position = 0): ExpressionError {
  return new ExpressionError("type", message, position);
}

export function evalError(message: string, position = 0): ExpressionError {
  return new ExpressionError("eval", message, position);
}
