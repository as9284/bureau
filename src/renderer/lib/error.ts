import type { BureauError, BureauErrorCode } from '@shared/contracts/errors';

/** Reconstruct a BureauError from either IPC channel (rejected promise or envelope). */
export function toError(err: unknown, operation: string): BureauError {
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    'message' in err &&
    typeof (err as BureauError).code === 'string'
  ) {
    return err as BureauError;
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: 'COMMAND_FAILED', message, operation, retryable: true };
}

const HEADINGS: Partial<Record<BureauErrorCode, string>> = {
  INVALID_SENDER: 'Blocked untrusted request',
  CAPABILITY_MISSING: 'A required tool is missing',
  PROJECT_NOT_FOUND: 'Project not found',
  CONFIG_CORRUPT: 'Project config could not be read',
  CONFIG_INCOMPATIBLE: 'Project config is from a newer Bureau',
  EXECUTABLE_NOT_FOUND: 'Executable not found',
  COMMAND_FAILED: 'Something went wrong',
};

export function errorHeading(error: BureauError): string {
  return HEADINGS[error.code] ?? 'Something went wrong';
}
