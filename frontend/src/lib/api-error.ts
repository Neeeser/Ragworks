export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly rawDetail: unknown;
  /** Backend correlation ID (`X-Request-ID`) for this failure, when present. */
  readonly requestId?: string;

  constructor(status: number, message: string, detail: unknown = message, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = message;
    this.rawDetail = detail;
    this.requestId = requestId;
  }
}

export function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}
