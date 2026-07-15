import type { BureauError, BureauErrorCode } from '@shared/contracts/errors';

const MAX_DETAIL_BYTES = 4096;

export function toBureauError(params: {
  code: BureauErrorCode;
  message: string;
  operation: string;
  subjectId?: string;
  retryable?: boolean;
  details?: string;
}): BureauError {
  return {
    code: params.code,
    message: params.message,
    operation: params.operation,
    subjectId: params.subjectId,
    retryable: params.retryable ?? false,
    details: sanitizeDetails(params.details),
  };
}

export function mapUnknownError(
  error: unknown,
  operation: string,
  subjectId?: string
): BureauError {
  if (isBureauError(error)) {
    return error;
  }

  if (isZodLikeError(error)) {
    const issues = error.issues
      .map((issue) => {
        const path = issue.path.filter(Boolean).join('.') || 'value';
        return `${path}: ${issue.message}`;
      })
      .join('; ');
    return toBureauError({
      code: 'INVALID_REQUEST',
      message: issues || 'Invalid request.',
      operation,
      subjectId,
      retryable: false,
    });
  }

  const message = error instanceof Error ? error.message : String(error);
  const sanitized = sanitizeDetails(message) ?? `${operation} failed`;

  return {
    code: 'COMMAND_FAILED',
    message: sanitized,
    operation,
    subjectId,
    retryable: false,
    details: sanitized,
  };
}

/** Electron IPC stringifies thrown plain objects poorly; always throw Error instances. */
export function throwMappedError(error: unknown, operation: string, subjectId?: string): never {
  const mapped = mapUnknownError(error, operation, subjectId);
  const err = new Error(mapped.message) as Error & BureauError;
  Object.assign(err, mapped);
  throw err;
}

export function isBureauError(error: unknown): error is BureauError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as BureauError).code === 'string' &&
    'message' in error &&
    typeof (error as BureauError).message === 'string'
  );
}

function isZodLikeError(
  error: unknown
): error is { issues: Array<{ path: PropertyKey[]; message: string }> } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'issues' in error &&
    Array.isArray((error as { issues: unknown }).issues)
  );
}

function sanitizeDetails(input: string | undefined): string | undefined {
  if (input === undefined) return undefined;
  let cleaned = input.replace(/\r?\n/g, ' ');
  // eslint-disable-next-line no-control-regex
  cleaned = cleaned.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  if (cleaned.length > MAX_DETAIL_BYTES) {
    cleaned = cleaned.slice(0, MAX_DETAIL_BYTES) + '…';
  }
  return cleaned.length > 0 ? cleaned : undefined;
}
