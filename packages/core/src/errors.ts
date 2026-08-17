/** Base for every error this codebase raises on purpose. */
export class FplError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Data crossing a boundary did not match its schema. */
export class ValidationError extends FplError {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[] = [], options?: { cause?: unknown }) {
    super('VALIDATION', message, options);
    this.issues = issues;
  }
}

/** A requested entity or dataset is absent from the store. */
export class NotFoundError extends FplError {
  constructor(what: string) {
    super('NOT_FOUND', `${what} not found`);
  }
}

/** An upstream source refused, rate limited, or returned an unusable payload. */
export class SourceError extends FplError {
  readonly source: string;
  /** HTTP status when the failure came from a response, so callers can treat
   * an expected 404 (a player with no published photo) as absence, not failure. */
  readonly status: number | undefined;

  constructor(source: string, message: string, options?: { cause?: unknown; status?: number }) {
    super('SOURCE', message, options);
    this.source = source;
    this.status = options?.status;
  }
}
