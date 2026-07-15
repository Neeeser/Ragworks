export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly rawDetail: unknown;

  constructor(status: number, message: string, detail: unknown = message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = message;
    this.rawDetail = detail;
  }
}

export function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}
